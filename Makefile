#
# luci-app-zn515xg-hw - Status -> Overview rework for the ZN515XG-D
#
# Two blocks are shipped:
#
#   view/status/include/15_hw.js        the "硬件监控" block; it replaces the
#                                       stock System block (10_system.js)
#   view/status/include/22_memstore.js  the "内存与储存" block; it merges the
#                                       stock Memory (20_memory.js) and
#                                       Storage (25_storage.js) tables into one
#                                       side by side row of cards
#
# The overview page discovers its includes by scanning that directory at
# runtime (luci-mod-status .../view/status/index.js: fs.list() -> filter *.js
# -> sort -> L.require()), so new file names are picked up without patching any
# file owned by luci-mod-status.  That is also what keeps this package
# installable with a plain `apk add`: the two packages never claim the same
# path.
#
# The three stock blocks this package replaces (10_system.js, 20_memory.js,
# 25_storage.js) are taken out of the scan by the package scripts below -
# renamed to *.js.disabled - and put back on removal.  Both scripts are no-ops
# during image build ($${IPKG_INSTROOT}) and when there is nothing to take
# over, so installing this package is idempotent.
#
include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-zn515xg-hw
PKG_VERSION:=1.0.0
PKG_RELEASE:=5

PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=czghzh <czghzh@users.noreply.github.com>

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-zn515xg-hw
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=ZN515XG-D Status -> Overview rework (hardware monitor + memory & storage)
  DEPENDS:=+luci-mod-status +rpcd +rpcd-mod-file
  PKGARCH:=all
endef

define Package/luci-app-zn515xg-hw/description
  Reworks LuCI's Status -> Overview page for the ZN515XG-D:
  a "硬件监控" block with board temperatures (CPU + WiFi), CPU usage with the
  live clock, the uplink up/down throughput and the TCP/UDP connection
  counters including their hardware offload share; and a "内存与储存" block
  that puts the stock Memory and Storage tables side by side as cards.
  The three stock blocks they replace are taken out of the way by the package
  scripts and restored when the package is removed.
endef

# This package ships plain scripts and JS only - there is no source to build.
# Without an explicit (empty) Build/Compile the default rule runs
# `make -C $(PKG_BUILD_DIR)` and dies with
# "No targets specified and no makefile found".
define Build/Compile
endef

define Package/luci-app-zn515xg-hw/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/status/include
	$(INSTALL_DATA) ./files/15_hw.js $(1)/www/luci-static/resources/view/status/include/15_hw.js
	$(INSTALL_DATA) ./files/22_memstore.js $(1)/www/luci-static/resources/view/status/include/22_memstore.js
	$(INSTALL_DIR) $(1)/www/luci-static/resources
	$(INSTALL_DATA) ./files/hardware_status.js $(1)/www/luci-static/resources/hardware_status.js
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/515xg-connstat $(1)/usr/sbin/515xg-connstat
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/luci-status-hardware.json $(1)/usr/share/rpcd/acl.d/luci-status-hardware.json
endef

# Move the stock blocks this package replaces out of the directory scan.
# "*.js.disabled" does not match the include loader's /\.js$/ filter, so they
# stop being rendered while staying one rename away from being restored.
#
#   10_system.js   -> replaced by 15_hw.js        ("硬件监控")
#   20_memory.js   -> replaced by 22_memstore.js  ("内存与储存")
#   25_storage.js  -> replaced by 22_memstore.js  ("内存与储存")
define Package/luci-app-zn515xg-hw/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

INC=/www/luci-static/resources/view/status/include
for f in 10_system 20_memory 25_storage; do
	if [ -f "$$INC/$$f.js" ]; then
		cp -p "$$INC/$$f.js" "$$INC/$$f.js.disabled" && rm -f "$$INC/$$f.js"
	fi
done
exit 0
endef

# Put them back on removal.  The .disabled copies are not owned by any package,
# so they survive this package's own file removal.
define Package/luci-app-zn515xg-hw/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

INC=/www/luci-static/resources/view/status/include
for f in 10_system 20_memory 25_storage; do
	if [ -f "$$INC/$$f.js.disabled" ]; then
		cp -p "$$INC/$$f.js.disabled" "$$INC/$$f.js" && rm -f "$$INC/$$f.js.disabled"
	fi
done
exit 0
endef

$(eval $(call BuildPackage,luci-app-zn515xg-hw))
