cmake_minimum_required(VERSION 3.20)

project(inkjet_emu_ghostpcl_wasm C)

include(ExternalProject)

if(NOT CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
  message(FATAL_ERROR "Configure this project through emcmake, for example: emcmake cmake -S . -B build/ghostpcl-wasm")
endif()

set(PROJECT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}")
set(GHOSTPCL_WASM_OUTPUT_DIR "${CMAKE_CURRENT_BINARY_DIR}/out")
set(GHOSTPCL_DIST_DIR "${PROJECT_ROOT}/dist")
set(BUNDLED_GHOSTPDL_ROOT "${PROJECT_ROOT}/ghostpcl")
set(BUNDLED_GHOSTPDL_BUILD "${CMAKE_CURRENT_BINARY_DIR}/ghostpdl-pcl-wasm")

set(DEFAULT_GHOSTPDL_ROOT "${BUNDLED_GHOSTPDL_ROOT}")
set(DEFAULT_GHOSTPDL_BUILD "${BUNDLED_GHOSTPDL_BUILD}")

if(DEFINED ENV{GHOSTPDL_ROOT})
  file(TO_CMAKE_PATH "$ENV{GHOSTPDL_ROOT}" DEFAULT_GHOSTPDL_ROOT)
endif()

if(DEFINED ENV{GHOSTPDL_BUILD})
  file(TO_CMAKE_PATH "$ENV{GHOSTPDL_BUILD}" DEFAULT_GHOSTPDL_BUILD)
endif()

set(GHOSTPDL_ROOT "${DEFAULT_GHOSTPDL_ROOT}" CACHE PATH "GhostPDL source root")
set(GHOSTPDL_BUILD "${DEFAULT_GHOSTPDL_BUILD}" CACHE PATH "CMake-managed GhostPDL wasm build tree")
set(GHOSTPDL_STATIC_LIBRARY "${GHOSTPDL_BUILD}/bin/gpcl6.a")
set(GHOSTPDL_EM_CACHE "${GHOSTPDL_BUILD}/emcache")

if(NOT EXISTS "${GHOSTPDL_ROOT}/configure")
  find_program(AUTORECONF_EXECUTABLE
    NAMES autoreconf
    REQUIRED
  )
  set(GHOSTPDL_BOOTSTRAP_COMMAND
    "${CMAKE_COMMAND}" -E chdir "${GHOSTPDL_ROOT}" "${AUTORECONF_EXECUTABLE}" -i
  )
else()
  set(GHOSTPDL_BOOTSTRAP_COMMAND
    "${CMAKE_COMMAND}" -E true
  )
endif()

find_program(GHOSTPDL_MAKE
  NAMES gmake make
  REQUIRED
)

get_filename_component(EMSCRIPTEN_BIN_DIR "${CMAKE_C_COMPILER}" DIRECTORY)

find_program(EMSCRIPTEN_AR
  NAMES emar
  HINTS "${EMSCRIPTEN_BIN_DIR}"
  REQUIRED
)

find_program(EMSCRIPTEN_RANLIB
  NAMES emranlib
  HINTS "${EMSCRIPTEN_BIN_DIR}"
  REQUIRED
)

if(NOT WASM_OPT)
  get_filename_component(EMSCRIPTEN_UPSTREAM_DIR "${EMSCRIPTEN_BIN_DIR}" DIRECTORY)
  find_program(WASM_OPT
    NAMES wasm-opt
    HINTS "${EMSCRIPTEN_UPSTREAM_DIR}/bin"
    REQUIRED
  )
endif()

if(NOT EXISTS "${WASM_OPT}")
  message(FATAL_ERROR "wasm-opt not found: ${WASM_OPT}")
endif()

ExternalProject_Add(ghostpdl-pcl-wasm
  SOURCE_DIR "${GHOSTPDL_ROOT}"
  BINARY_DIR "${GHOSTPDL_BUILD}"
  CONFIGURE_COMMAND
    ${GHOSTPDL_BOOTSTRAP_COMMAND}
    COMMAND "${CMAKE_COMMAND}" -E make_directory "<BINARY_DIR>"
    COMMAND "${CMAKE_COMMAND}" -E make_directory "${GHOSTPDL_EM_CACHE}"
    COMMAND "${CMAKE_COMMAND}" -E chdir "<BINARY_DIR>"
      "${CMAKE_COMMAND}" -E env "EM_CACHE=${GHOSTPDL_EM_CACHE}"
      "<SOURCE_DIR>/configure"
      "--host=wasm32-unknown-emscripten"
      "--with-gs=no"
      "--with-pcl=gpcl6"
      "--with-xps=no"
      "--with-pdf=no"
      "--with-gpdl=no"
      "--disable-compile-inits"
      "--without-x"
      "--disable-cups"
      "--disable-gtk"
      "--disable-dbus"
      "--disable-fontconfig"
      "--without-tesseract"
      "--without-libidn"
      "--without-libpaper"
      "--without-ijs"
      "--without-urf"
      "--without-so"
      "--without-cal"
      "--disable-openjpeg"
      "--without-libtiff"
      "--with-drivers=pdfwrite,png16m"
      "CC=${CMAKE_C_COMPILER}"
      "AR=${EMSCRIPTEN_AR}"
      "RANLIB=${EMSCRIPTEN_RANLIB}"
      "CCAUX=cc"
      "CXXAUX=c++"
  BUILD_COMMAND
    "${CMAKE_COMMAND}" -E rm -f
      "${GHOSTPDL_STATIC_LIBRARY}"
      "${GHOSTPDL_BUILD}/obj/libgpcl6_a.tr"
    COMMAND
    "${CMAKE_COMMAND}" -E env "EM_CACHE=${GHOSTPDL_EM_CACHE}"
    "${GHOSTPDL_MAKE}"
    "AR=${EMSCRIPTEN_AR}"
    "RANLIB=${EMSCRIPTEN_RANLIB}"
    "TARGET_ARCH_FILE=${GHOSTPDL_BUILD}/arch-config/arch_autoconf.h"
    libgpcl6
  INSTALL_COMMAND ""
  BUILD_BYPRODUCTS "${GHOSTPDL_STATIC_LIBRARY}"
)

add_executable(gpcl-stream
  c/gpcl_stream_wrapper.c
  c/tokenizer.c
)

add_dependencies(gpcl-stream ghostpdl-pcl-wasm)

set_property(TARGET gpcl-stream PROPERTY
  RULE_LAUNCH_COMPILE "${CMAKE_COMMAND} -E env EM_CACHE=${GHOSTPDL_EM_CACHE}"
)
set_property(TARGET gpcl-stream PROPERTY
  RULE_LAUNCH_LINK "${CMAKE_COMMAND} -E env EM_CACHE=${GHOSTPDL_EM_CACHE}"
)

target_compile_options(gpcl-stream PRIVATE
  -Oz
  -g0
)

target_include_directories(gpcl-stream PRIVATE
  "${GHOSTPDL_ROOT}"
  "${GHOSTPDL_BUILD}/obj"
  "${GHOSTPDL_BUILD}/arch-config"
)

target_link_options(gpcl-stream PRIVATE
  -Oz
  -g0
  --no-entry
  "SHELL:-sMODULARIZE=1"
  "SHELL:-sEXPORT_ES6=1"
  "SHELL:-sEXPORT_NAME=createGpclStreamModule"
  "SHELL:-sEXPORTED_FUNCTIONS=[\"_gpcl_stream_create\",\"_gpcl_stream_push\",\"_gpcl_stream_destroy\"]"
  "SHELL:-sEXPORTED_RUNTIME_METHODS=[\"FS\"]"
  "SHELL:-sFORCE_FILESYSTEM=1"
  "SHELL:-sENVIRONMENT=web,worker,node"
  "SHELL:-sMALLOC=emmalloc"
  "SHELL:-sALLOW_MEMORY_GROWTH=1"
  "SHELL:-sINVOKE_RUN=0"
)

target_link_libraries(gpcl-stream PRIVATE
  -Wl,--whole-archive
  "${GHOSTPDL_STATIC_LIBRARY}"
  -Wl,--no-whole-archive
  m
  dl
  pthread
)

set_target_properties(gpcl-stream PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${GHOSTPCL_WASM_OUTPUT_DIR}"
  OUTPUT_NAME "gpcl-stream"
  SUFFIX ".js"
)

add_custom_command(TARGET gpcl-stream POST_BUILD
  COMMAND "${WASM_OPT}"
    --enable-bulk-memory
    --enable-nontrapping-float-to-int
    -Oz
    --strip-debug
    --strip-dwarf
    --strip-producers
    "$<TARGET_FILE_DIR:gpcl-stream>/gpcl-stream.wasm"
    -o
    "$<TARGET_FILE_DIR:gpcl-stream>/gpcl-stream.wasm"
  VERBATIM
)

add_custom_command(
  OUTPUT
    "${GHOSTPCL_DIST_DIR}/gpcl-stream.js"
    "${GHOSTPCL_DIST_DIR}/gpcl-stream.wasm"
  COMMAND "${CMAKE_COMMAND}" -E make_directory "${GHOSTPCL_DIST_DIR}"
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
    "$<TARGET_FILE_DIR:gpcl-stream>/gpcl-stream.js"
    "${GHOSTPCL_DIST_DIR}/gpcl-stream.js"
  COMMAND "${CMAKE_COMMAND}" -E copy_if_different
    "$<TARGET_FILE_DIR:gpcl-stream>/gpcl-stream.wasm"
    "${GHOSTPCL_DIST_DIR}/gpcl-stream.wasm"
  DEPENDS
    gpcl-stream
  VERBATIM
)

add_custom_target(gpcl-stream-dist
  DEPENDS
    "${GHOSTPCL_DIST_DIR}/gpcl-stream.js"
    "${GHOSTPCL_DIST_DIR}/gpcl-stream.wasm"
)
