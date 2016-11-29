#
# Main Makefile. This is basically the same as a component makefile.
#
# This Makefile should, at the very least, just include $(SDK_PATH)/make/component_common.mk. By default, 
# this will take the sources in the src/ directory, compile them and link them into 
# lib(subdirectory_name).a in the build directory. This behaviour is entirely configurable,
# please read the ESP-IDF documents if you need to do this.
#
CFLAGS += -DCS_PLATFORM=3 \
	-DMG_DISABLE_DIRECTORY_LISTING=1 \
	-DMG_DISABLE_DAV=1 \
	-DMG_DISABLE_CGI=1 \
	-DMG_DISABLE_FILESYSTEM=1 \
	-DMG_LWIP=1 -DDUK_OPT_DEBUGGER_SUPPORT=1 -DDUK_OPT_INTERRUPT_COUNTER=1