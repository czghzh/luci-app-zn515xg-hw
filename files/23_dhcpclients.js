'use strict';
'require baseclass';
'require rpc';
'require fs';

/*
 * ZNXT ZN515XG-D: "DHCPv4 在线客户端" block for Status -> Overview.
 *
 * Shipped under the *new* file name view/status/include/23_dhcpclients.js, so
 * the overview page's runtime directory scan (luci-mod-status
 * .../view/status/index.js: fs.list() -> filter *.js -> sort -> L.require())
 * picks it up without touching a file owned by luci-mod-status - which is what
 * keeps the package installable with a plain `apk add`.
 *
 * The "23_" prefix is load-bearing: includes are sorted by file name, so 23
 * lands right after this package's own 22_memstore.js ("内存与储存") and before
 * the stock 29_ports.js - i.e. the card renders directly below 内存与储存,
 * which is where the user asked for it.  (An earlier revision used 18_, which
 * put it *above* 内存与储存, between 15_hw.js and 22_memstore.js.)
 *
 * The title is deliberately NOT _('DHCP Leases'): the per-section show/hide
 * state is keyed by the title in localStorage (index.js does
 * includes[i].id = title), so reusing the stock title would inherit a section
 * the user had hidden and make this block look like it never rendered.
 *
 * ---------------------------------------------------------------------------
 * Why a helper script instead of luci-rpc getDHCPLeases directly
 * ---------------------------------------------------------------------------
 * getDHCPLeases gives hostname / macaddr / ipaddr / expires / interface, and
 * that `interface` is the *logical* one (br-lan).  The card has to say
 * "wifi5G / wifi2.4G / lan1 / lan2", which only the layer 2 tables know:
 *
 *   bridge fdb show br br-lan   MAC -> physical port (lan1, phy1-ap0, ...)
 *   /proc/net/arp               the IP is really live (Flags != 0x0)
 *
 * So /usr/sbin/515xg-dhcphosts runs those lookups and prints one line per
 * online client, TAB separated:
 *
 *   hostname <TAB> ipaddr <TAB> macaddr <TAB> iface
 *
 * The three-way gate it applies (lease unexpired + MAC present in the FDB +
 * IP reachable in ARP) is the "真实在线" definition the user asked for; see the
 * long note inside that script.  A client whose port cannot be resolved still
 * comes back, with "-" in the iface column - never dropped, never guessed.
 *
 * ---------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------------
 * One full width card, a header row and one row per client, matching the
 * neighbouring blocks' card surface (background-color-medium, 1px
 * border-color-low, 6px radius).  The four columns are given fixed shares with
 * CSS grid so the header and the data rows line up without a <table> - a table
 * would bring the theme's own borders and padding and stop looking like the
 * other cards.
 *
 * Style note: CSS strings are built with plain concatenation, not with
 * String.prototype.format().  That helper only substitutes when the *first*
 * '%' starts a valid conversion, so a bare "100%" inside a style string would
 * silently disable every placeholder behind it.  (Same rule as 15_hw.js /
 * 22_memstore.js.)
 */

/* fs.exec() is luci-base's own wrapper around file.exec (fs.js declares it with
 * params = [ 'command', 'params', 'env' ], i.e. positionally).  Using it keeps
 * this module in line with hardware_status.js, which already shells out through
 * the same helper and the same call convention. */
var HELPER = '/usr/sbin/515xg-dhcphosts';

/* theme variables with literal fallbacks, same set as the other two blocks */
function css(name, fallback) {
	return 'var(--' + name + ', ' + fallback + ')';
}

var cCardBg  = css('background-color-medium', '#f9f9f9');
var cBorder  = css('border-color-low', '#eeeeee');
/* One muted grey, the same token 15_hw.js settled on - the three blocks sit on
 * one page and a lighter grey here would read as a mistake. */
var cMuted   = css('text-color-medium', '#808080');
var cStrong  = css('text-color-highest', '#000000');

var S_CARD     = 'background: ' + cCardBg + '; border: 1px solid ' + cBorder +
                 '; border-radius: 6px; padding: 10px 12px';
var S_CARD_TITLE = 'font-size: 12px; color: ' + cMuted + '; margin-bottom: 8px';

/* Header and data rows share this grid, so the columns line up exactly.  Name
 * column is the one that can run long, so it keeps the flexible share while
 * the other three are sized to their content. */
var S_ROW      = 'display: grid; grid-template-columns: minmax(6em, 1.4fr) minmax(9em, 1fr) minmax(9em, 1fr) minmax(4em, 0.7fr); gap: 12px; align-items: baseline';
var S_HEAD     = 'font-size: 11px; color: ' + cMuted + '; padding-bottom: 6px; border-bottom: 1px solid ' + cBorder;
var S_CELL     = 'font-size: 12px; color: ' + cStrong + '; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; min-width: 0';
var S_EMPTY    = 'font-size: 13px; color: ' + cMuted;
/* The iface column is the card's whole point, so it gets the accent colour to
 * stand out from the three identity columns. */
var S_IFACE    = 'font-size: 12px; color: ' + css('primary-color-high', '#1976d2') + '; font-variant-numeric: tabular-nums';

function row(cells, opts) {
	var style = S_ROW + ((opts && opts.head) ? '; ' + S_HEAD : '');

	return E('div', { 'style': style }, cells.map(function(c, i) {
		var s = (opts && opts.head) ? 'font-size: 11px; color: ' + cMuted
		      : (i === 3 ? S_IFACE : S_CELL);
		return E('span', { 'style': s }, [ (c != null) ? c : '-' ]);
	}));
}

/* Parse the helper's TAB separated output.  Blank lines are dropped; a short
 * line is padded with '-' rather than throwing the row away, so a malformed
 * entry shows up as a visibly incomplete row instead of vanishing. */
function parse(text) {
	var out = [], lines = String(text || '').split('\n');

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		if (!line.replace(/\s/g, ''))
			continue;

		var f = line.split('\t');

		out.push({
			host:    f[0] || '-',
			ipaddr:  f[1] || '-',
			macaddr: f[2] || '-',
			iface:   f[3] || '-'
		});
	}

	return out;
}

return baseclass.extend({
	title: _('DHCPv4 在线客户端'),

	load: function() {
		return L.resolveDefault(fs.exec(HELPER), { stdout: '' });
	},

	render: function(res) {
		var clients = parse((res && res.stdout) || '');

		var body = [];

		if (!clients.length) {
			body.push(E('div', { 'style': S_EMPTY }, [ _('当前无在线客户端') ]));
		}
		else {
			body.push(row([ _('主机名'), _('IPv4 地址'), _('MAC 地址'), _('接口') ], { head: true }));

			for (var i = 0; i < clients.length; i++) {
				var c = clients[i];

				body.push(E('div', {
					'style': S_ROW + '; margin-top: ' + (i === 0 ? '8px' : '6px')
				}, [
					E('span', { 'style': S_CELL },  [ c.host ]),
					E('span', { 'style': S_CELL },  [ c.ipaddr ]),
					E('span', { 'style': S_CELL },  [ c.macaddr ]),
					E('span', { 'style': S_IFACE }, [ c.iface ])
				]));
			}
		}

		return E('div', { 'style': 'display: flex; flex-wrap: wrap; gap: 12px' }, [
			E('div', { 'style': S_CARD + '; flex: 1 1 100%; min-width: 0' }, [
				E('div', { 'style': S_CARD_TITLE }, [
					_('DHCPv4 在线客户端') + ' · ' + clients.length
				]),
				E('div', {}, body)
			])
		]);
	}
});
