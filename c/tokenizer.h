#ifndef GPCL_TOKENIZER_H
#define GPCL_TOKENIZER_H

#define GPCL_TOKEN_MAX 4096
#define GPCL_PJL_PREFIX_MAX 9

typedef enum gpcl_token_state_e {
    GPCL_TOKEN_IDLE = 0,
    GPCL_TOKEN_ESC,
    GPCL_TOKEN_ESC_QUESTION,
    GPCL_TOKEN_AFTER_CLASS,
    GPCL_TOKEN_PARAMETER,
    GPCL_TOKEN_COMBINED_PARAMETER
} gpcl_token_state_t;

typedef struct gpcl_tokenizer_output_s {
    void (*write)(void *user_data, const unsigned char *data, unsigned int length);
    void (*fail)(void *user_data);
    void *user_data;
} gpcl_tokenizer_output_t;

typedef struct gpcl_tokenizer_s {
    gpcl_token_state_t token_state;
    unsigned char token[GPCL_TOKEN_MAX];
    unsigned int token_len;
    unsigned int payload_remaining;
    unsigned char pjl_prefix[GPCL_PJL_PREFIX_MAX];
    unsigned int pjl_prefix_len;
    int pjl_at_line_start;
    int pjl_probe_enabled;
    int pjl_header_active;
    int pjl_handoff_pending;
    unsigned char *pjl_header;
    unsigned int pjl_header_len;
    unsigned int pjl_header_cap;
    unsigned char pcl_class;
    unsigned char pcl_group;
    int param_sign;
    unsigned int param_value;
    int param_seen_digit;
} gpcl_tokenizer_t;

/**
 * The tokenizer is a minimal PCL processor that breaks the stream
 * into the smallest chunks that GhostPDL can handle.
 */
void gpcl_tokenizer_init(gpcl_tokenizer_t *tokenizer);
void gpcl_tokenizer_push(gpcl_tokenizer_t *tokenizer, unsigned char value,
                         const gpcl_tokenizer_output_t *output);
void gpcl_tokenizer_finish(gpcl_tokenizer_t *tokenizer,
                           const gpcl_tokenizer_output_t *output);
void gpcl_tokenizer_free(gpcl_tokenizer_t *tokenizer);

#endif
