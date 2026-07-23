#include <stdlib.h>
#include <stdio.h>
#include "gpcl_stream_wrapper.h"
#include "pcl/pl/plapi.h"
#include "tokenizer.h"

typedef struct gpcl_instance_s {
    void *instance;
    int running;
    int failed;
} gpcl_instance_t;

typedef struct gpcl_stream_s {
    gpcl_instance_t png;
    gpcl_instance_t pdf;
    gpcl_tokenizer_t tokenizer;
} gpcl_stream_t;

static int
gpcl_instance_start(gpcl_instance_t *target, int argc, char **argv)
{
    int code;
    int exit_code = 0;

    target->instance = NULL;
    target->running = 0;
    target->failed = 0;

    code = gsapi_new_instance(&target->instance, NULL);
    if (code < 0)
        return code;

    code = gsapi_set_arg_encoding(target->instance, PL_ARG_ENCODING_UTF8);
    if (code < 0)
        return code;

    code = gsapi_init_with_args(target->instance, argc, argv);
    if (code < 0)
        return code;

    code = gsapi_run_string_begin(target->instance, 0, &exit_code);
    if (code < 0)
        return code;

    target->running = 1;
    return 0;
}

static void
gpcl_instance_push_bytes(gpcl_instance_t *target, const unsigned char *data,
                         unsigned int length)
{
    int exit_code = 0;
    int code;

    if (!target->running || target->failed)
        return;
    if (length == 0)
        return;

    code = gsapi_run_string_continue(target->instance, (const char *)data,
                                     length, 0, &exit_code);
    if (code < 0)
        target->failed = code;
}

static void
gpcl_instance_finish(gpcl_instance_t *target)
{
    int exit_code = 0;

    if (target->instance == NULL)
        return;

    if (target->running) {
        gsapi_run_string_end(target->instance, 0, &exit_code);
        target->running = 0;
    }

    gsapi_exit(target->instance);
    gsapi_delete_instance(target->instance);
    target->instance = NULL;
}

static void
gpcl_stream_write(void *user_data, const unsigned char *data, unsigned int length)
{
    gpcl_stream_t *stream = (gpcl_stream_t *)user_data;

    gpcl_instance_push_bytes(&stream->png, data, length);
    gpcl_instance_push_bytes(&stream->pdf, data, length);
}

static void
gpcl_stream_fail(void *user_data)
{
    gpcl_stream_t *stream = (gpcl_stream_t *)user_data;

    if (stream->png.failed == 0)
        stream->png.failed = -1;
    if (stream->pdf.failed == 0)
        stream->pdf.failed = -1;
}

static gpcl_tokenizer_output_t
gpcl_stream_tokenizer_output(gpcl_stream_t *stream)
{
    gpcl_tokenizer_output_t output;

    output.write = gpcl_stream_write;
    output.fail = gpcl_stream_fail;
    output.user_data = stream;
    return output;
}

void *
gpcl_stream_create(int png_ppi)
{
    gpcl_stream_t *stream;
    char resolution_arg[32];

    char *png_argv[] = {
        "gpcl_stream_png",
        "-dNOPAUSE",
        "-dBATCH",
        resolution_arg,
        "-sDEVICE=png16m",
        "-sOutputFile=/work/thumb-%06d.png",
    };

    char *pdf_argv[] = {
        "gpcl_stream_pdf",
        "-dNOPAUSE",
        "-dBATCH",
        "-sDEVICE=pdfwrite",
        "-sOutputFile=/work/file.pdf",
    };

    if (png_ppi <= 0)
        return NULL;

    setenv("PCLFONTSOURCE", "/windows/fonts/", 1);

    stream = (gpcl_stream_t *)calloc(1, sizeof(*stream));
    if (stream == NULL)
        return NULL;

    gpcl_tokenizer_init(&stream->tokenizer);
    snprintf(resolution_arg, sizeof(resolution_arg), "-r%d", png_ppi);

    if (gpcl_instance_start(&stream->png,
                            (int)(sizeof(png_argv) / sizeof(png_argv[0])),
                            png_argv) < 0) {
        gpcl_stream_destroy(stream);
        return NULL;
    }

    if (gpcl_instance_start(&stream->pdf,
                            (int)(sizeof(pdf_argv) / sizeof(pdf_argv[0])),
                            pdf_argv) < 0) {
        gpcl_stream_destroy(stream);
        return NULL;
    }

    return stream;
}

void
gpcl_stream_push(void *handle, int byte_value)
{
    gpcl_stream_t *stream = (gpcl_stream_t *)handle;
    gpcl_tokenizer_output_t output;
    unsigned char value = (unsigned char)(byte_value & 0xff);

    if (stream == NULL)
        return;

    output = gpcl_stream_tokenizer_output(stream);
    gpcl_tokenizer_push(&stream->tokenizer, value, &output);
}

void
gpcl_stream_destroy(void *handle)
{
    gpcl_stream_t *stream = (gpcl_stream_t *)handle;
    gpcl_tokenizer_output_t output;

    if (stream == NULL)
        return;

    output = gpcl_stream_tokenizer_output(stream);
    gpcl_tokenizer_finish(&stream->tokenizer, &output);
    gpcl_instance_finish(&stream->png);
    gpcl_instance_finish(&stream->pdf);
    gpcl_tokenizer_free(&stream->tokenizer);
    free(stream);
}
