'use strict';
'require baseclass';
'require rpc';
'require fs';

/*
 * ZNXT ZN515XG-D: "在线客户端" block for Status -> Overview.
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
 * Title: just "在线客户端" (user, 2026-10-07 - it was "DHCPv4 在线客户端" for one
 * revision).  It covers both address families now that the card carries an IPv6
 * column, so naming it after DHCPv4 alone under-sold it.  Note it is still
 * deliberately NOT the stock _('DHCP Leases'): the per-section show/hide state
 * is keyed by the title in localStorage (index.js does includes[i].id = title),
 * so reusing the stock title would inherit a section the user had hidden and
 * make this block look like it never rendered.  Renaming from the old title is
 * likewise safe - a new key just starts with the default (visible) state.
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
 *   hostname <TAB> ipaddr <TAB> ip6addr <TAB> macaddr <TAB> iface
 *
 * The three-way gate it applies (lease unexpired + MAC present in the FDB +
 * IP reachable in ARP) is the "真实在线" definition the user asked for; see the
 * long note inside that script.  A client whose port cannot be resolved still
 * comes back, with "-" in the iface column - never dropped, never guessed.
 *
 * ip6addr is resolved from `ip -6 neigh show dev br-lan` by MAC, from the
 * device's point of view: the MAC is what links the DHCPv4 lease to the global
 * IPv6 address the client is actually using.  One address per client, picked by
 * neighbour state (REACHABLE > DELAY > PROBE > STALE) after dropping fe80::
 * and FAILED entries; "-" when there is nothing usable.  Privacy extensions
 * mean this value drifts over time - that is normal IPv6 behaviour, not a bug,
 * and it is why the script sorts by freshness instead of by address type.
 *
 * ---------------------------------------------------------------------------
 * Layout
 * ---------------------------------------------------------------------------
 * One full width card, a header row and one row per client, matching the
 * neighbouring blocks' card surface (background-color-medium, 1px
 * border-color-low, 6px radius).  The columns are given fixed shares with
 * CSS grid so the header and the data rows line up without a <table> - a table
 * would bring the theme's own borders and padding and stop looking like the
 * other cards.
 *
 * Column order (user, 2026-10-10):
 *   主机名 / IPv4 / MAC / 网速 / IPv6 / 接口
 * i.e. 网速 sits *between* MAC and IPv6 - MAC is the anchor you read a client
 * by, and the IPv6 column is the longest one, so it stays on the right where it
 * has room to break.  (The IPv6 column used to come before MAC; the two were
 * swapped when the rate column was added.)
 *
 * ---------------------------------------------------------------------------
 * 网速列（2026-10-10 加）
 * ---------------------------------------------------------------------------
 * 数据来源是另一个脚本 /usr/sbin/515xg-clientsrate，前端按 MAC 合并。
 * 为什么不由本块自己算：速率需要两次采样的差值，脚本得在 /tmp 留一份快照，
 * 那是「谁在线」这种一次性查询不该背的状态。
 *
 * 为什么不能按 MAC 建 nft 计数器（在 192.168.16.1 实测）：这台机器上
 * flowtable 卸载是开着的（ruleset 里有 ft / fb 两个 flowtable，都带
 * flags offload；FDB 里的客户端条目带 offload 标记），卸载的流不再走 nft
 * 的 forward 链，计数器基本读不到数。无线客户端改用 iw station 的 rx/tx
 * 计数（实测带 offload 标记照样在涨），有线口没有 per-MAC 计数，只有该口
 * 独占一个 MAC 时用端口计数近似，否则脚本给 "-"。
 *
 * 单位用 Mibit/s，跟「硬件监控」的 Pon 端口速率一致 —— 两块卡上出现 Mbit/s
 * 和 Mibit/s 两种写法会被当成两个不同的东西。
 *
 * 取值三种状态：有速率 / 全 0（空闲，整格半透明）/ 取不到（灰色 "-"，不画
 * 箭头 —— 画了箭头却没数字会被读成「速率为 0」）。
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

/* 网速列的数据源，单独一个脚本：它要在 /tmp 留快照才能算差值，跟「谁在线」
 * 这种一次性查询不是一回事，硬塞进 dhcphosts 只会让两边都难改。
 * 两边按 MAC 对齐（MAC 就是这两张表的连接键）。 */
var RATEHELPER = '/usr/sbin/515xg-clientsrate';

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
/* 网速数值的橙色。主题里没有橙色这个 token，所以走「变量名 + 兜底」的写法：
 * 哪天主题定义了 --orange-color-high 就自动跟主题走，没定义就用我们这个。
 * 深色主题下 #f5821f 对比度约 4.7:1，够看。 */
var cOrange  = css('orange-color-high', '#f5821f');

var S_CARD     = 'background: ' + cCardBg + '; border: 1px solid ' + cBorder +
                 '; border-radius: 6px; padding: 10px 12px';
var S_CARD_TITLE = 'font-size: 12px; color: ' + cMuted + '; margin-bottom: 8px';

/* Header and data rows share this grid, so the columns line up exactly.  Six
 * columns now (was five before the rate column):
 *   主机名 / IPv4 / MAC / 网速 / IPv6 / 接口
 * The rate column is the widest fixed share: it carries two readings plus two
 * unit labels, and it must not wrap - a wrapped rate reads as two clients.
 * The IPv6 column keeps enough room for a full 39 character address. */
var S_ROW      = 'display: grid; grid-template-columns: minmax(6em, 1.1fr) minmax(8.5em, 0.9fr) minmax(9.5em, 1fr) minmax(14em, 1.2fr) minmax(11em, 1.4fr) minmax(4.5em, 0.6fr); gap: 10px; align-items: baseline';
/* 表头统一用主文字色（用户 2026-10-10 改）：浅色主题下就是黑色，深色主题下是白色，
 * 跟数据行的「身份」列一个色，整行看起来才是一体的。
 * 所以 S_HEAD 只留字号和下边框，颜色交给每一格自己。 */
var S_HEAD     = 'font-size: 11px; padding-bottom: 6px; border-bottom: 1px solid ' + cBorder;
var S_HEAD_TEXT  = 'font-size: 11px; color: ' + cStrong;
var S_CELL     = 'font-size: 12px; color: ' + cStrong + '; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; min-width: 0';
/* The IPv6 address is long enough to overflow its column on narrow screens, so
 * it is set one step smaller and is allowed to break at the colons.  Same
 * colour as the other identity columns - it is not the card's point, the iface
 * column is. */
var S_CELL6    = 'font-size: 11px; color: ' + cStrong + '; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; word-break: break-all; min-width: 0';
var S_EMPTY    = 'font-size: 13px; color: ' + cMuted;
/* The iface column: same main text colour as the other columns (user asked for
 * it to be black in the light theme, i.e. --text-color-highest). */
var S_IFACE    = 'font-size: 12px; color: ' + cStrong + '; font-variant-numeric: tabular-nums';

/* ---- 网速列 -------------------------------------------------------------
 * 整列左对齐（用户 2026-10-10 改）：跟表头方向一致。
 * 上下行两组之间用 flex 的 gap 拉开 —— 早先用 "&nbsp;" 分隔时两组会顶在一起。 */
var S_RATE     = 'display: flex; justify-content: flex-start; gap: 14px; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap';
/* 箭头：橙色，字号比数字大 2px。↑↓ 的字形比阿拉伯数字矮，跟数字同字号时
 * 看着会小一号，多给 2px 才视觉等高。 */
var S_ARROW    = 'color: ' + cOrange + '; font-size: 14px; line-height: 1; font-weight: 600';
/* 数值：用主题的主文字色（深色主题下就是白色，浅色主题下是黑色）。
 * 这里刻意不硬写 #fff —— 浅色卡底是 #f9f9f9，白字在上面等于看不见。
 * 定宽 7ch（够装 2500.00 这种 2.5G 满速的 7 位值）+ 左对齐：每组宽度恒定，
 * 上一组的箭头跟上一组对齐、下一组的箭头跟下一组对齐，不会因数值位数不同而错位。 */
var S_RATE_NUM = 'color: ' + cStrong + '; font-weight: 600; display: inline-block; min-width: 7ch; text-align: left';
/* 单位：灰色、定宽、左贴数值，这样上下两行的 Mibit/s 也对齐。 */
var S_RATE_UNIT = 'color: ' + cMuted + '; font-size: 11px; display: inline-block; min-width: 5.5ch; text-align: left';
/* 取不到速率时的占位：灰色 "-"，左对齐，不画箭头。 */
var S_RATE_NA  = 'font-size: 12px; color: ' + cMuted + '; text-align: left';

/* One reading: 箭头 + 数值 + 单位 */
function rateGroup(arrow, value) {
	return E('span', {}, [
		E('span', { 'style': S_ARROW     }, [ arrow ]),
		E('span', { 'style': S_RATE_NUM  }, [ value ]),
		E('span', { 'style': S_RATE_UNIT }, [ 'Mibit/s' ])
	]);
}

/* 网速单元格。三种状态：
 *   有速率 -> 蓝箭头 + 橙数值；上下行都是 0（空闲）时整格降到 55% 不透明度，
 *             否则整列全彩，扫一眼看不出谁在跑流量。
 *   取不到 -> 灰色 "-"（第一次打开卡片时就是这样，脚本要先留一次快照才能算
 *             差值，下一轮刷新就有数了）。
 * 不画箭头也不写 0：那会被读成「真的没流量」。 */
function rateCell(rate) {
	if (!rate || rate.down == null || rate.up == null)
		return E('span', { 'style': S_RATE_NA }, [ '-' ]);

	var idle = (parseFloat(rate.down) === 0 && parseFloat(rate.up) === 0);

	return E('span', { 'style': S_RATE + (idle ? '; opacity: .55' : '') }, [
		rateGroup('↓', rate.down),
		rateGroup('↑', rate.up)
	]);
}

/* Header row.  Built here rather than through a generic row() helper because
 * the rate header is right aligned while the rest are not - one special case
 * in a shared helper is how headers and data rows start to drift apart. */
function headRow() {
	return E('div', { 'style': S_ROW + '; ' + S_HEAD }, [
		E('span', { 'style': S_HEAD_TEXT   }, [ _('主机名')   ]),
		E('span', { 'style': S_HEAD_TEXT   }, [ _('IPv4 地址') ]),
		E('span', { 'style': S_HEAD_TEXT   }, [ _('MAC 地址') ]),
		E('span', { 'style': S_HEAD_TEXT   }, [ _('网速')     ]),
		E('span', { 'style': S_HEAD_TEXT   }, [ _('IPv6 地址') ]),
		E('span', { 'style': S_HEAD_TEXT   }, [ _('接口')     ])
	]);
}

/* Parse the rate helper's TAB separated "mac<TAB>down<TAB>up" output into a
 * lowercase-MAC -> { down, up } map.  '-' means "no baseline yet", which is
 * kept as null so rateCell() can render the placeholder instead of a fake 0. */
function parseRates(text) {
	var out = {}, lines = String(text || '').split('\n');

	for (var i = 0; i < lines.length; i++) {
		var f = lines[i].split('\t');

		if (f.length < 3)
			continue;

		var mac = String(f[0] || '').toLowerCase();

		if (!mac)
			continue;

		out[mac] = {
			down: (f[1] && f[1] !== '-') ? f[1] : null,
			up:   (f[2] && f[2] !== '-') ? f[2] : null
		};
	}

	return out;
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
			ip6addr: f[2] || '-',
			macaddr: f[3] || '-',
			iface:   f[4] || '-'
		});
	}

	return out;
}

return baseclass.extend({
	title: _('在线客户端'),

	load: function() {
		/* 两个脚本各跑一次：一份是「谁在线」，一份是「谁跑多快」。
		 * 后者拿不到也不影响卡片渲染（rateCell() 会画 "-"），所以两边都用
		 * L.resolveDefault 兜底，不让一次失败把整张卡片拖没。 */
		return Promise.all([
			L.resolveDefault(fs.exec(HELPER), { stdout: '' }),
			L.resolveDefault(fs.exec(RATEHELPER), { stdout: '' })
		]);
	},

	render: function(data) {
		var res  = (data && data[0]) || {},
		    resR = (data && data[1]) || {},
		    clients = parse(res.stdout || ''),
		    rates   = parseRates(resR.stdout || '');

		var body = [];

		if (!clients.length) {
			body.push(E('div', { 'style': S_EMPTY }, [ _('当前无在线客户端') ]));
		}
		else {
			body.push(headRow());

			for (var i = 0; i < clients.length; i++) {
				var c = clients[i];

				/* MAC 是 dhcphosts 与 clientsrate 两张表的连接键，两边大小写
				 * 可能不一致，统一转小写再查。 */
				var rate = rates[String(c.macaddr).toLowerCase()];

				body.push(E('div', {
					'style': S_ROW + '; margin-top: ' + (i === 0 ? '8px' : '6px')
				}, [
					E('span', { 'style': S_CELL  }, [ c.host ]),
					E('span', { 'style': S_CELL  }, [ c.ipaddr ]),
					E('span', { 'style': S_CELL  }, [ c.macaddr ]),
					rateCell(rate),
					E('span', { 'style': S_CELL6 }, [ c.ip6addr ]),
					E('span', { 'style': S_IFACE }, [ c.iface ])
				]));
			}
		}

		return E('div', { 'style': 'display: flex; flex-wrap: wrap; gap: 12px' }, [
			E('div', { 'style': S_CARD + '; flex: 1 1 100%; min-width: 0' }, [
				E('div', { 'style': S_CARD_TITLE }, [
					_('在线客户端') + ' · ' + clients.length
				]),
				E('div', {}, body)
			])
		]);
	}
});
