#!/bin/sh
# Installed as the apk pre-deinstall script (prerm).  Standard OpenWrt
# prelude - it only lets the platform do its own teardown; this package has
# nothing to stop before the files go away.
[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0
. ${IPKG_INSTROOT}/lib/functions.sh
export root="${IPKG_INSTROOT}"
export pkgname="luci-app-zn515xg-hw"
default_prerm
exit 0
