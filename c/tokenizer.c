#include <stdlib.h>
#include <string.h>
#include "tokenizer.h"

static int
gpcl_is_escape_class(unsigned char value)
{
    return value >= '!' && value <= '/';
}

static int
gpcl_is_escape_group(unsigned char value)
{
    return value >= '`' && value <= '~';
}

static int
gpcl_is_parameter_byte(unsigned char value)
{
    return value >= ' ' && value <= '?';
}

static int
gpcl_is_upper_command(unsigned char value)
{
    return value >= '@' && value <= '^';
}

static int
gpcl_is_lower_command(unsigned char value)
{
    return value >= '`' && value <= '~';
}

static unsigned char
gpcl_normalize_command(unsigned char value)
{
    return gpcl_is_lower_command(value) ? (unsigned char)(value - 32) : value;
}

static void
gpcl_tokenizer_reset_parameter(gpcl_tokenizer_t *tokenizer)
{
    tokenizer->param_sign = 1;
    tokenizer->param_value = 0;
    tokenizer->param_seen_digit = 0;
}

static void
gpcl_tokenizer_note_parameter_byte(gpcl_tokenizer_t *tokenizer, unsigned char value)
{
    if (value >= '0' && value <= '9') {
        tokenizer->param_seen_digit = 1;
        if (tokenizer->param_value <= 655350)
            tokenizer->param_value = tokenizer->param_value * 10 + (unsigned int)(value - '0');
        return;
    }

    if (!tokenizer->param_seen_digit && value == '-')
        tokenizer->param_sign = -1;
    else if (!tokenizer->param_seen_digit && value == '+')
        tokenizer->param_sign = 1;
}

static unsigned int
gpcl_tokenizer_parameter_count(const gpcl_tokenizer_t *tokenizer)
{
    if (tokenizer->param_sign < 0 || !tokenizer->param_seen_digit)
        return 0;
    return tokenizer->param_value;
}

static int
gpcl_command_has_byte_data(unsigned char pcl_class, unsigned char pcl_group,
                           unsigned char command)
{
    switch (pcl_class) {
        case '&':
            return (pcl_group == 'a' && command == 'W') ||
                   (pcl_group == 'b' && command == 'W') ||
                   (pcl_group == 'n' && command == 'W') ||
                   (pcl_group == 'p' && command == 'X');
        case '(':
            return (pcl_group == 'f' && command == 'W') ||
                   (pcl_group == 's' && command == 'W');
        case ')':
            return pcl_group == 's' && command == 'W';
        case '*':
            return (pcl_group == 'b' && (command == 'V' || command == 'W')) ||
                   (pcl_group == 'c' && command == 'W') ||
                   (pcl_group == 'g' && command == 'W') ||
                   (pcl_group == 'i' && command == 'W') ||
                   (pcl_group == 'l' && command == 'W') ||
                   (pcl_group == 'm' && command == 'W') ||
                   (pcl_group == 'o' && command == 'W') ||
                   (pcl_group == 'v' && command == 'W');
        default:
            return 0;
    }
}

static void
gpcl_tokenizer_output_fail(const gpcl_tokenizer_output_t *output)
{
    if (output != NULL && output->fail != NULL)
        output->fail(output->user_data);
}

static void
gpcl_tokenizer_write_raw(const gpcl_tokenizer_output_t *output,
                         const unsigned char *data, unsigned int length)
{
    if (length == 0)
        return;
    if (output != NULL && output->write != NULL)
        output->write(output->user_data, data, length);
}

static int
gpcl_tokenizer_append_pjl_header(gpcl_tokenizer_t *tokenizer,
                                 const unsigned char *data, unsigned int length,
                                 const gpcl_tokenizer_output_t *output)
{
    unsigned int new_cap;
    unsigned char *new_header;

    if (length == 0)
        return 1;

    if (tokenizer->pjl_header_len + length > tokenizer->pjl_header_cap) {
        new_cap = tokenizer->pjl_header_cap == 0 ? 256 : tokenizer->pjl_header_cap;
        while (new_cap < tokenizer->pjl_header_len + length)
            new_cap *= 2;

        new_header = (unsigned char *)realloc(tokenizer->pjl_header, new_cap);
        if (new_header == NULL) {
            gpcl_tokenizer_output_fail(output);
            return 0;
        }

        tokenizer->pjl_header = new_header;
        tokenizer->pjl_header_cap = new_cap;
    }

    memcpy(tokenizer->pjl_header + tokenizer->pjl_header_len, data, length);
    tokenizer->pjl_header_len += length;
    return 1;
}

static void
gpcl_tokenizer_write(gpcl_tokenizer_t *tokenizer, const unsigned char *data,
                     unsigned int length, const gpcl_tokenizer_output_t *output)
{
    unsigned int total_length;
    unsigned char *combined;

    if (!tokenizer->pjl_handoff_pending) {
        gpcl_tokenizer_write_raw(output, data, length);
        return;
    }

    total_length = tokenizer->pjl_header_len + length;
    combined = (unsigned char *)malloc(total_length);
    if (combined != NULL) {
        memcpy(combined, tokenizer->pjl_header, tokenizer->pjl_header_len);
        memcpy(combined + tokenizer->pjl_header_len, data, length);
        gpcl_tokenizer_write_raw(output, combined, total_length);
        free(combined);
    } else {
        gpcl_tokenizer_write_raw(output, tokenizer->pjl_header, tokenizer->pjl_header_len);
        gpcl_tokenizer_write_raw(output, data, length);
    }

    tokenizer->pjl_header_len = 0;
    tokenizer->pjl_handoff_pending = 0;
    tokenizer->pjl_probe_enabled = 0;
}

static int
gpcl_tokenizer_idle(const gpcl_tokenizer_t *tokenizer)
{
    return tokenizer->payload_remaining == 0 &&
           tokenizer->token_state == GPCL_TOKEN_IDLE &&
           tokenizer->token_len == 0;
}

static void
gpcl_tokenizer_flush_token(gpcl_tokenizer_t *tokenizer,
                           const gpcl_tokenizer_output_t *output)
{
    if (tokenizer->token_len != 0)
        gpcl_tokenizer_write(tokenizer, tokenizer->token, tokenizer->token_len, output);

    tokenizer->token_len = 0;
    tokenizer->token_state = GPCL_TOKEN_IDLE;
    tokenizer->pcl_class = 0;
    tokenizer->pcl_group = 0;
    gpcl_tokenizer_reset_parameter(tokenizer);
}

static void
gpcl_tokenizer_discard_token(gpcl_tokenizer_t *tokenizer)
{
    tokenizer->token_len = 0;
    tokenizer->token_state = GPCL_TOKEN_IDLE;
    tokenizer->pcl_class = 0;
    tokenizer->pcl_group = 0;
    gpcl_tokenizer_reset_parameter(tokenizer);
}

static int
gpcl_tokenizer_append_token(gpcl_tokenizer_t *tokenizer, unsigned char value,
                            const gpcl_tokenizer_output_t *output)
{
    if (tokenizer->token_len == sizeof(tokenizer->token)) {
        gpcl_tokenizer_flush_token(tokenizer, output);
        return 0;
    }

    tokenizer->token[tokenizer->token_len++] = value;
    return 1;
}

static void
gpcl_tokenizer_finish_command(gpcl_tokenizer_t *tokenizer, unsigned char command_byte,
                              const gpcl_tokenizer_output_t *output)
{
    unsigned char command = gpcl_normalize_command(command_byte);
    unsigned int count = gpcl_tokenizer_parameter_count(tokenizer);
    int has_byte_data = gpcl_command_has_byte_data(tokenizer->pcl_class,
                                                   tokenizer->pcl_group,
                                                   command);
    int is_combined = gpcl_is_lower_command(command_byte) && !has_byte_data;

    if (has_byte_data && count > 0 &&
        count <= sizeof(tokenizer->token) - tokenizer->token_len) {
        tokenizer->payload_remaining = count;
        tokenizer->token_state = GPCL_TOKEN_IDLE;
    } else {
        gpcl_tokenizer_write(tokenizer, tokenizer->token, tokenizer->token_len, output);
        tokenizer->token_len = 0;

        if (has_byte_data && count > 0)
            tokenizer->payload_remaining = count;

        tokenizer->token_state = is_combined ? GPCL_TOKEN_COMBINED_PARAMETER : GPCL_TOKEN_IDLE;
    }

    gpcl_tokenizer_reset_parameter(tokenizer);
}

static void
gpcl_tokenizer_resync_on_escape(gpcl_tokenizer_t *tokenizer)
{
    tokenizer->token_state = GPCL_TOKEN_ESC;
    tokenizer->pcl_class = 0;
    tokenizer->pcl_group = 0;
    gpcl_tokenizer_reset_parameter(tokenizer);
}

static void
gpcl_tokenizer_push_tokenized(gpcl_tokenizer_t *tokenizer, unsigned char value,
                              const gpcl_tokenizer_output_t *output)
{
    if (tokenizer->payload_remaining != 0) {
        if (tokenizer->token_len != 0) {
            if (tokenizer->token_len == sizeof(tokenizer->token))
                gpcl_tokenizer_flush_token(tokenizer, output);

            if (tokenizer->token_len != 0) {
                tokenizer->token[tokenizer->token_len++] = value;
            } else {
                gpcl_tokenizer_write(tokenizer, &value, 1, output);
            }
            tokenizer->payload_remaining--;
            if (tokenizer->payload_remaining == 0 ||
                tokenizer->token_len == sizeof(tokenizer->token))
                gpcl_tokenizer_flush_token(tokenizer, output);
        } else {
            gpcl_tokenizer_write(tokenizer, &value, 1, output);
            tokenizer->payload_remaining--;
        }
        return;
    }

    switch (tokenizer->token_state) {
        case GPCL_TOKEN_IDLE:
            if (value == 0x1b) {
                gpcl_tokenizer_append_token(tokenizer, value, output);
                tokenizer->token_state = GPCL_TOKEN_ESC;
            } else {
                gpcl_tokenizer_write(tokenizer, &value, 1, output);
            }
            break;

        case GPCL_TOKEN_ESC:
            if (!gpcl_tokenizer_append_token(tokenizer, value, output))
                gpcl_tokenizer_push_tokenized(tokenizer, value, output);
            else if (value == 0x1b)
                gpcl_tokenizer_resync_on_escape(tokenizer);
            else if (value == '?')
                tokenizer->token_state = GPCL_TOKEN_ESC_QUESTION;
            else if (gpcl_is_escape_class(value)) {
                tokenizer->pcl_class = value;
                tokenizer->pcl_group = 0;
                gpcl_tokenizer_reset_parameter(tokenizer);
                tokenizer->token_state = GPCL_TOKEN_AFTER_CLASS;
            } else {
                gpcl_tokenizer_flush_token(tokenizer, output);
            }
            break;

        case GPCL_TOKEN_ESC_QUESTION:
            if (value == 0x11) {
                gpcl_tokenizer_discard_token(tokenizer);
            } else {
                gpcl_tokenizer_flush_token(tokenizer, output);
                gpcl_tokenizer_push_tokenized(tokenizer, value, output);
            }
            break;

        case GPCL_TOKEN_AFTER_CLASS:
            if (!gpcl_tokenizer_append_token(tokenizer, value, output)) {
                gpcl_tokenizer_push_tokenized(tokenizer, value, output);
            } else if (gpcl_is_escape_group(value)) {
                tokenizer->pcl_group = value;
                gpcl_tokenizer_reset_parameter(tokenizer);
                tokenizer->token_state = GPCL_TOKEN_PARAMETER;
            } else if (gpcl_is_parameter_byte(value)) {
                tokenizer->pcl_group = 0;
                gpcl_tokenizer_note_parameter_byte(tokenizer, value);
                tokenizer->token_state = GPCL_TOKEN_PARAMETER;
            } else if (gpcl_is_upper_command(value) || gpcl_is_lower_command(value)) {
                tokenizer->pcl_group = 0;
                gpcl_tokenizer_finish_command(tokenizer, value, output);
            } else if (value == 0x1b) {
                gpcl_tokenizer_resync_on_escape(tokenizer);
            } else {
                gpcl_tokenizer_flush_token(tokenizer, output);
            }
            break;

        case GPCL_TOKEN_PARAMETER:
        case GPCL_TOKEN_COMBINED_PARAMETER:
            if (!gpcl_tokenizer_append_token(tokenizer, value, output)) {
                gpcl_tokenizer_push_tokenized(tokenizer, value, output);
            } else if (gpcl_is_parameter_byte(value)) {
                gpcl_tokenizer_note_parameter_byte(tokenizer, value);
            } else if (gpcl_is_upper_command(value) || gpcl_is_lower_command(value)) {
                gpcl_tokenizer_finish_command(tokenizer, value, output);
            } else if (value == 0x1b) {
                gpcl_tokenizer_resync_on_escape(tokenizer);
            } else {
                gpcl_tokenizer_flush_token(tokenizer, output);
            }
            break;
    }
}

static void
gpcl_tokenizer_push_pcl_byte(gpcl_tokenizer_t *tokenizer, unsigned char value,
                             const gpcl_tokenizer_output_t *output)
{
    gpcl_tokenizer_push_tokenized(tokenizer, value, output);
    tokenizer->pjl_at_line_start = value == '\n';
}

static int
gpcl_pjl_prefix_matches(const unsigned char *data, unsigned int length,
                        const unsigned char *candidate,
                        unsigned int candidate_length)
{
    unsigned int i;

    if (length > candidate_length)
        return 0;

    for (i = 0; i < length; i++) {
        if (data[i] != candidate[i])
            return 0;
    }

    return 1;
}

static int
gpcl_pjl_prefix_is_full_atpjl(const unsigned char *data, unsigned int length)
{
    static const unsigned char atpjl[] = {'@', 'P', 'J', 'L'};
    static const unsigned char cr_atpjl[] = {'\r', '@', 'P', 'J', 'L'};
    static const unsigned char lf_atpjl[] = {'\n', '@', 'P', 'J', 'L'};
    static const unsigned char crlf_atpjl[] = {'\r', '\n', '@', 'P', 'J', 'L'};

    return (length == sizeof(atpjl) &&
            gpcl_pjl_prefix_matches(data, length, atpjl, sizeof(atpjl))) ||
           (length == sizeof(cr_atpjl) &&
            gpcl_pjl_prefix_matches(data, length, cr_atpjl, sizeof(cr_atpjl))) ||
           (length == sizeof(lf_atpjl) &&
            gpcl_pjl_prefix_matches(data, length, lf_atpjl, sizeof(lf_atpjl))) ||
           (length == sizeof(crlf_atpjl) &&
            gpcl_pjl_prefix_matches(data, length, crlf_atpjl, sizeof(crlf_atpjl)));
}

static int
gpcl_pjl_prefix_is_possible_atpjl(const unsigned char *data, unsigned int length)
{
    static const unsigned char atpjl[] = {'@', 'P', 'J', 'L'};
    static const unsigned char cr_atpjl[] = {'\r', '@', 'P', 'J', 'L'};
    static const unsigned char lf_atpjl[] = {'\n', '@', 'P', 'J', 'L'};
    static const unsigned char crlf_atpjl[] = {'\r', '\n', '@', 'P', 'J', 'L'};

    return gpcl_pjl_prefix_matches(data, length, atpjl, sizeof(atpjl)) ||
           gpcl_pjl_prefix_matches(data, length, cr_atpjl, sizeof(cr_atpjl)) ||
           gpcl_pjl_prefix_matches(data, length, lf_atpjl, sizeof(lf_atpjl)) ||
           gpcl_pjl_prefix_matches(data, length, crlf_atpjl, sizeof(crlf_atpjl));
}

static int
gpcl_pjl_prefix_is_full_uel(const unsigned char *data, unsigned int length)
{
    static const unsigned char uel[] = {0x1b, '%', '-', '1', '2', '3', '4', '5', 'X'};

    return length == sizeof(uel) &&
           gpcl_pjl_prefix_matches(data, length, uel, sizeof(uel));
}

static int
gpcl_pjl_prefix_is_possible_uel(const unsigned char *data, unsigned int length)
{
    static const unsigned char uel[] = {0x1b, '%', '-', '1', '2', '3', '4', '5', 'X'};

    return gpcl_pjl_prefix_matches(data, length, uel, sizeof(uel));
}

static void
gpcl_tokenizer_flush_pjl_prefix_as_pcl(gpcl_tokenizer_t *tokenizer,
                                       const gpcl_tokenizer_output_t *output)
{
    unsigned int i;
    unsigned int length = tokenizer->pjl_prefix_len;
    unsigned char prefix[GPCL_PJL_PREFIX_MAX];

    if (length == 0)
        return;

    for (i = 0; i < length; i++)
        prefix[i] = tokenizer->pjl_prefix[i];

    tokenizer->pjl_prefix_len = 0;
    for (i = 0; i < length; i++)
        gpcl_tokenizer_push_pcl_byte(tokenizer, prefix[i], output);
}

static void
gpcl_tokenizer_write_pjl_prefix(gpcl_tokenizer_t *tokenizer, int leaves_line_start,
                                const gpcl_tokenizer_output_t *output)
{
    tokenizer->pjl_header_active = 1;
    gpcl_tokenizer_append_pjl_header(tokenizer, tokenizer->pjl_prefix,
                                     tokenizer->pjl_prefix_len, output);
    tokenizer->pjl_prefix_len = 0;
    tokenizer->pjl_at_line_start = leaves_line_start;
}

static void
gpcl_tokenizer_start_pjl_handoff(gpcl_tokenizer_t *tokenizer)
{
    tokenizer->pjl_header_active = 0;
    tokenizer->pjl_handoff_pending = 1;
    tokenizer->pjl_prefix_len = 0;
}

void
gpcl_tokenizer_init(gpcl_tokenizer_t *tokenizer)
{
    memset(tokenizer, 0, sizeof(*tokenizer));
    gpcl_tokenizer_reset_parameter(tokenizer);
    tokenizer->pjl_at_line_start = 1;
    tokenizer->pjl_probe_enabled = 1;
}

void
gpcl_tokenizer_push(gpcl_tokenizer_t *tokenizer, unsigned char value,
                    const gpcl_tokenizer_output_t *output)
{
    if (tokenizer->pjl_header_active && !tokenizer->pjl_at_line_start) {
        gpcl_tokenizer_append_pjl_header(tokenizer, &value, 1, output);
        tokenizer->pjl_at_line_start = value == '\n';
        return;
    }

    if (!gpcl_tokenizer_idle(tokenizer)) {
        gpcl_tokenizer_flush_pjl_prefix_as_pcl(tokenizer, output);
        gpcl_tokenizer_push_pcl_byte(tokenizer, value, output);
        return;
    }

    if (tokenizer->pjl_prefix_len == 0 && !tokenizer->pjl_probe_enabled) {
        gpcl_tokenizer_push_pcl_byte(tokenizer, value, output);
        return;
    }

    if (tokenizer->pjl_prefix_len == 0 && value == 0x1b) {
        tokenizer->pjl_prefix[tokenizer->pjl_prefix_len++] = value;
        return;
    }

    if (tokenizer->pjl_prefix_len == 0 && !tokenizer->pjl_at_line_start) {
        gpcl_tokenizer_push_pcl_byte(tokenizer, value, output);
        return;
    }

    if (tokenizer->pjl_prefix_len == 0) {
        if (value != 0x1b && value != '@' && value != '\r' && value != '\n') {
            tokenizer->pjl_probe_enabled = 0;
            gpcl_tokenizer_push_pcl_byte(tokenizer, value, output);
            return;
        }
    }

    if (tokenizer->pjl_prefix_len == sizeof(tokenizer->pjl_prefix)) {
        gpcl_tokenizer_flush_pjl_prefix_as_pcl(tokenizer, output);
        gpcl_tokenizer_push_pcl_byte(tokenizer, value, output);
        return;
    }

    tokenizer->pjl_prefix[tokenizer->pjl_prefix_len++] = value;

    if (gpcl_pjl_prefix_is_full_uel(tokenizer->pjl_prefix, tokenizer->pjl_prefix_len)) {
        tokenizer->pjl_probe_enabled = 1;
        gpcl_tokenizer_write_pjl_prefix(tokenizer, 1, output);
        return;
    }

    if (gpcl_pjl_prefix_is_full_atpjl(tokenizer->pjl_prefix, tokenizer->pjl_prefix_len)) {
        gpcl_tokenizer_write_pjl_prefix(tokenizer, 0, output);
        return;
    }

    if (gpcl_pjl_prefix_is_possible_uel(tokenizer->pjl_prefix, tokenizer->pjl_prefix_len) ||
        gpcl_pjl_prefix_is_possible_atpjl(tokenizer->pjl_prefix, tokenizer->pjl_prefix_len))
        return;

    if (tokenizer->pjl_header_active) {
        unsigned int i;
        unsigned int length = tokenizer->pjl_prefix_len;
        unsigned char prefix[GPCL_PJL_PREFIX_MAX];

        for (i = 0; i < length; i++)
            prefix[i] = tokenizer->pjl_prefix[i];

        gpcl_tokenizer_start_pjl_handoff(tokenizer);
        for (i = 0; i < length; i++)
            gpcl_tokenizer_push_pcl_byte(tokenizer, prefix[i], output);
    } else {
        tokenizer->pjl_probe_enabled = 0;
        gpcl_tokenizer_flush_pjl_prefix_as_pcl(tokenizer, output);
    }
}

void
gpcl_tokenizer_finish(gpcl_tokenizer_t *tokenizer,
                      const gpcl_tokenizer_output_t *output)
{
    gpcl_tokenizer_flush_pjl_prefix_as_pcl(tokenizer, output);
    if (tokenizer->pjl_header_len != 0) {
        gpcl_tokenizer_write_raw(output, tokenizer->pjl_header, tokenizer->pjl_header_len);
        tokenizer->pjl_header_len = 0;
    }
    gpcl_tokenizer_flush_token(tokenizer, output);
}

void
gpcl_tokenizer_free(gpcl_tokenizer_t *tokenizer)
{
    free(tokenizer->pjl_header);
    tokenizer->pjl_header = NULL;
    tokenizer->pjl_header_len = 0;
    tokenizer->pjl_header_cap = 0;
}
