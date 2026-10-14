<?php
/**
 * Plugin Name: stag-inspect (chỉ bản dev)
 * Description: stag.ai — chế độ Soi: gắn data-stag-src vào HTML để biết phần tử đến từ block nào (bài #ID), file template
 *              nào của theme / plugin (child hay parent theme). Chỉ chạy trên bản local: môi trường local / development
 *              (WP_ENVIRONMENT_TYPE), site chạy ở localhost / *.local / *.test, hoặc khi wp-config.php có
 *              define('STAG_INSPECT', true). define('STAG_INSPECT', false) tắt hẳn. WP_DEBUG không còn bật plugin (staging
 *              hay bật WP_DEBUG). Tắt page cache khi chạy. Xoá file này là gỡ.
 * Version: 1.1.0
 * Author: stag.ai
 */

if (!defined('ABSPATH')) {
	exit;
}

/** Site chạy trên máy này: localhost, 127.x, ::1, hoặc tên miền dev (*.local, *.test, *.localhost). */
function stag_inspect_local_host() {
	$host = strtolower((string) wp_parse_url(home_url(), PHP_URL_HOST));
	$host = trim($host, '[]');
	if ($host === 'localhost' || $host === '::1' || preg_match('/^127\.\d+\.\d+\.\d+$/', $host)) {
		return true;
	}
	return (bool) preg_match('/\.(local|test|localhost)$/', $host);
}

/**
 * Chỉ bản dev, phải bật rõ ràng: STAG_INSPECT (true / false) thắng mọi thứ; không có thì môi trường local /
 * development, hoặc site ở localhost. Không dựa vào WP_DEBUG: lỡ chép lên staging / production (hay bật WP_DEBUG)
 * thì không lộ đường dẫn theme.
 */
function stag_inspect_enabled() {
	if (is_admin() || wp_doing_ajax() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST)) {
		return false;
	}
	if (defined('STAG_INSPECT')) {
		return (bool) STAG_INSPECT;
	}
	$env = function_exists('wp_get_environment_type') ? wp_get_environment_type() : 'production';
	return in_array($env, array('local', 'development'), true) || stag_inspect_local_host();
}

if (!stag_inspect_enabled()) {
	return;
}

// Sửa xong tải lại phải thấy ngay: không cache trang khi đang soi.
if (!defined('DONOTCACHEPAGE')) {
	define('DONOTCACHEPAGE', true);
}
add_action('send_headers', 'nocache_headers');

/** Đường dẫn file tính từ wp-content (vd. "themes/my-child/header.php"), kèm "(parent theme)" khi là theme cha. */
function stag_inspect_rel($file) {
	$file = wp_normalize_path($file);
	$content = trailingslashit(wp_normalize_path(WP_CONTENT_DIR));
	$rel = strpos($file, $content) === 0 ? substr($file, strlen($content)) : $file;
	$parent = wp_normalize_path(get_template_directory());
	$child = wp_normalize_path(get_stylesheet_directory());
	if ($parent !== $child && strpos($file, trailingslashit($parent)) === 0) {
		$rel .= ' · (parent theme)';
	}
	return $rel;
}

/** Dòng của thẻ HTML đầu tiên trong file template (bỏ qua đoạn PHP mở đầu). */
function stag_inspect_first_tag_line($file) {
	$lines = @file($file);
	if (!$lines) {
		return 1;
	}
	foreach ($lines as $i => $line) {
		if (preg_match('/<[a-zA-Z]/', preg_replace('/<\?php.*?(\?>|$)/', '', $line))) {
			return $i + 1;
		}
	}
	return 1;
}

/** Thêm thuộc tính vào thẻ mở đầu tiên của đoạn HTML (không đè nếu đã có). */
function stag_inspect_tag_first($html, $value) {
	if (!is_string($html) || $html === '') {
		return $html;
	}
	if (class_exists('WP_HTML_Tag_Processor')) {
		$p = new WP_HTML_Tag_Processor($html);
		if ($p->next_tag()) {
			if ($p->get_attribute('data-stag-src') === null) {
				$p->set_attribute('data-stag-src', $value);
			}
			return $p->get_updated_html();
		}
		return $html;
	}
	if (preg_match('/^\s*<[a-zA-Z][^>]*\sdata-stag-src=/', $html)) {
		return $html;
	}
	return preg_replace('/<([a-zA-Z][a-zA-Z0-9-]*)(\s|>|\/)/', '<$1 data-stag-src="' . esc_attr($value) . '"$2', $html, 1);
}

// Block (Gutenberg, block theme): "post:12 · block 3 · core/paragraph" — sửa bằng WP-CLI trên bản local.
add_filter('render_block', function ($html, $block, $instance = null) {
	static $count = array();
	// REST (trình sửa block xem trước) không cần nguồn.
	if (empty($block['blockName']) || (defined('REST_REQUEST') && REST_REQUEST)) {
		return $html;
	}
	$post_id = 0;
	if ($instance && isset($instance->context['postId'])) {
		$post_id = (int) $instance->context['postId'];
	}
	if (!$post_id) {
		$post_id = (int) get_the_ID();
	}
	$key = $post_id ?: 'tpl';
	$count[$key] = isset($count[$key]) ? $count[$key] + 1 : 1;
	$name = $block['blockName'];
	if ($name === 'core/template-part' && !empty($block['attrs']['slug'])) {
		$value = 'template-part:' . $block['attrs']['slug'] . ' · ' . $name;
	} elseif ($post_id) {
		$value = 'post:' . $post_id . ' · block ' . $count[$key] . ' · ' . $name;
	} else {
		$value = 'template · block ' . $count[$key] . ' · ' . $name;
	}
	return stag_inspect_tag_first($html, $value);
}, 99, 3);

// Template PHP của theme / plugin (theme cổ điển): đánh dấu quanh mỗi lần nạp template, cuối trang đổi thành thuộc
// tính trên thẻ đầu tiên của phần đó. Cần WP 6.1+ (wp_before_load_template).
add_action('wp_before_load_template', function ($file) {
	echo '<!--stag-src:' . esc_html(stag_inspect_rel($file) . ':' . stag_inspect_first_tag_line($file)) . '-->';
}, 0);

// Cuối trang: xoá mọi dấu (dấu của header.php nằm trước <!doctype>, để lại sẽ làm trang vào quirks mode) và gắn
// data-stag-src lên thẻ hiển thị đầu tiên sau mỗi dấu (bỏ qua <html>, <head>, <body>, <script>…), nếu thẻ đó nằm
// trước dấu kế tiếp và chưa có nguồn (block).
add_action('template_redirect', function () {
	ob_start('stag_inspect_apply_markers');
}, 0);

function stag_inspect_apply_markers($html) {
	if (!is_string($html) || strpos($html, '<!--stag-src:') === false) {
		return $html;
	}
	preg_match_all('/<!--stag-src:(.*?)-->/', $html, $all, PREG_OFFSET_CAPTURE);
	$edits = array();
	$n = count($all[0]);
	for ($i = 0; $i < $n; $i++) {
		$start = $all[0][$i][1];
		$end = $start + strlen($all[0][$i][0]);
		$edits[] = array($start, $end - $start, '');
		$limit = $i + 1 < $n ? $all[0][$i + 1][1] : strlen($html);
		// "themes/x/footer.php · (parent theme):6" → "themes/x/footer.php:6 · (parent theme)"
		$v = html_entity_decode($all[1][$i][0]);
		if (preg_match('/^(.*?) · \(parent theme\):(\d+)$/', $v, $p)) {
			$v = $p[1] . ':' . $p[2] . ' · (parent theme)';
		}
		if (!preg_match('/<(?!(?:html|head|meta|link|title|script|style|base|body|noscript)[\s>\/])[a-zA-Z][a-zA-Z0-9-]*(?=[\s>\/])/i', $html, $t, PREG_OFFSET_CAPTURE, $end) || $t[0][1] >= $limit) {
			continue;
		}
		$tag_end = $t[0][1] + strlen($t[0][0]);
		$close = strpos($html, '>', $tag_end);
		if ($close !== false && strpos(substr($html, $tag_end, $close - $tag_end), 'data-stag-src=') !== false) {
			continue;
		}
		$edits[] = array($tag_end, 0, ' data-stag-src="' . esc_attr($v) . '"');
	}
	// Sửa từ cuối lên để vị trí phía trước không lệch.
	usort($edits, function ($a, $b) {
		return $b[0] - $a[0];
	});
	foreach ($edits as $e) {
		$html = substr_replace($html, $e[2], $e[0], $e[1]);
	}
	return $html;
}

// Template chính (front-page.php, single.php…): ghi lên <body>.
add_filter('template_include', function ($template) {
	$GLOBALS['stag_inspect_template'] = $template;
	return $template;
}, 999);
add_action('wp_body_open', function () {
	if (!empty($GLOBALS['stag_inspect_template'])) {
		echo '<meta name="stag-template" content="' . esc_attr(stag_inspect_rel($GLOBALS['stag_inspect_template'])) . '">';
	}
});
