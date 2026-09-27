#
# luci-app-zn515xg-hw - hardware status block for LuCI's Status -> Overview
#
# The block itself is view/status/include/15_hw.js.  The overview page
# discovers its includes by scanning that directory at runtime
# (luci-mod-status .../view/status/index.js: fs.list() -> filter *.js -> sort
# -> L.require()), so a new file name is picked up without patching any file
# owned by luci-mod-status.  That is also what keeps this package installable
# with a plain `apk add`: the two packages never claim the same path.
#
# The stock "System" block is taken over, not duplicated - the package scripts
# below rename it out of the scan and put it back on removal.  Both scripts are
# no-ops during image build ($${IPKG_INSTROOT}) and when there is nothing to
# take over, so installing this package is idempotent.
#
include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-zn515xg-hw
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=czghzh <czghzh@users.noreply.github.com>

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-zn515xg-hw
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=ZN515XG-D hardware status block for Status -> Overview
  DEPENDS:=+luci-mod-status +rpcd +rpcd-mod-file
  PKGARCH:=all
endef

define Package/luci-app-zn515xg-hw/description
  Adds a "硬件监控" block to LuCI's Status -> Overview page: board temperatures
  (CPU + WiFi), CPU usage with the live clock, the uplink up/down throughput and
  the TCP/UDP connection counters including their hardware offload share.
  Taking the stock "System" block out of the way is done by the package
  scripts and undone when the package is removed.
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
	$(INSTALL_DIR) $(1)/www/luci-static/resources
	$(INSTALL_DATA) ./files/hardware_status.js $(1)/www/luci-static/resources/hardware_status.js
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/515xg-connstat $(1)/usr/sbin/515xg-connstat
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./files/luci-status-hardware.json $(1)/usr/share/rpcd/acl.d/luci-status-hardware.json
endef

# Move the stock block out of the directory scan.  "*.js.disabled" does not
# match the include loader's /\.js$/ filter, so the stock block stops being
# rendered while staying one rename away from being restored.
define Package/luci-app-zn515xg-hw/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

STOCK=/www/luci-static/resources/view/status/include/10_system.js
if [ -f "$$STOCK" ]; then
	cp -p "$$STOCK" "$$STOCK.disabled" && rm -f "$$STOCK"
fi
exit 0
endef

# Put it back on removal.  The .disabled copy is not owned by any package, so
# it survives this package's own file removal.
define Package/luci-app-zn515xg-hw/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

STOCK=/www/luci-static/resources/view/status/include/10_system.js
if [ -f "$$STOCK.disabled" ]; then
	cp -p "$$STOCK.disabled" "$$STOCK" && rm -f "$$STOCK.disabled"
fi
exit 0
endef

$(eval $(call BuildPackage,luci-app-zn515xg-hw))
