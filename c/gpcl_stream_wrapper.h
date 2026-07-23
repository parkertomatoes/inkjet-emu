#ifndef GPCL_STREAM_WRAPPER_H
#define GPCL_STREAM_WRAPPER_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Creates a GhostPCL stream
 *
 * Creates two GhostPCL PLAPI instances: one to render 
 * PNGs of each page, and one to convert it all to PDF.
 * These are pushed to at the same time *_push() is called.
 *
 * @param png_ppi PPI to render PNGs at
 * @returns An opaque handle to the stream
 */
void *gpcl_stream_create(int png_ppi);

/**
 * @brief Push PCL bytes to the GhostPCL stream
 * @param handle The stream handle
 * @param byte_value Value of the PCL byte to push
 * @note This may trigger a PNG file write, so it is not output-free
 */
void gpcl_stream_push(void *handle, int byte_value);

/**
 * @brief Closes the GhostPCL stream and finishes processing
 * @param handle The stream handle
 * @note This may trigger either a PNG file write, and also a PDF write.
 */
void gpcl_stream_destroy(void *handle);

#ifdef __cplusplus
}
#endif

#endif
