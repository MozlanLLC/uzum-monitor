package uz.pricewatch.monitor;

import android.net.Uri;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Сайты, за товарами которых следит приложение. У каждого: как узнать ссылку на товар, как привести её
 * к одному виду, каким скриптом читать страницу и с каких адресов разрешены картинки.
 * То же описано в extension/src/core.js расширения для браузера.
 */
public final class Sites {

    private Sites() {}

    public static final String UZUM = "uzum", OZON = "ozon", WB = "wb";

    /** Разобранная ссылка на товар. */
    public static final class Link {
        public final String site, url;
        public final long productId, skuId;

        Link(String site, String url, long productId, long skuId) {
            this.site = site;
            this.url = url;
            this.productId = productId;
            this.skuId = skuId;
        }
    }

    private static final String HOSTS = "(uzum\\.uz|ozon\\.uz|wildberries\\.uz)";
    private static final Pattern LINK = Pattern.compile("https?://(?:www\\.)?" + HOSTS + "/[^\\s\"'<>]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern BARE = Pattern.compile("(?:^|\\s)((?:www\\.)?" + HOSTS + "/[^\\s\"'<>]+)", Pattern.CASE_INSENSITIVE);

    private static final Pattern UZUM_PATH = Pattern.compile("/product/(?:[^/?#]*?-)?(\\d+)/?(?:[?#].*)?$");
    private static final Pattern OZON_PATH = Pattern.compile("/product/(?:[^/?#]*-)?(\\d+)/?(?:[?#].*)?$");
    private static final Pattern WB_PATH = Pattern.compile("/catalog/(\\d+)/detail\\.aspx(?:[?#].*)?$");
    private static final Pattern UZUM_SKU = Pattern.compile("[?&]skuId=(\\d+)");
    private static final Pattern WB_SIZE = Pattern.compile("[?&]size=(\\d+)");

    private static final Pattern UZUM_IMAGE = Pattern.compile("^https://images\\.uzum\\.uz/.*");
    private static final Pattern OZON_IMAGE = Pattern.compile("^https://(?:ir(?:-\\d+)?|cdn\\d*)\\.ozone\\.ru/.*");
    private static final Pattern WB_IMAGE = Pattern.compile("^https://[a-z0-9-]+\\.(?:wbbasket\\.ru|wbcontent\\.net|geobasket\\.net)/.*");

    public static String normalize(String site) {
        return OZON.equals(site) || WB.equals(site) ? site : UZUM;
    }

    private static String siteOfHost(String host) {
        String h = host.toLowerCase(java.util.Locale.ROOT);
        if (h.equals("ozon.uz")) return OZON;
        if (h.equals("wildberries.uz")) return WB;
        return UZUM;
    }

    private static Pattern path(String site) {
        if (OZON.equals(site)) return OZON_PATH;
        if (WB.equals(site)) return WB_PATH;
        return UZUM_PATH;
    }

    private static String hint(String site) {
        if (OZON.equals(site)) return "ozon.uz/product/название-123456";
        if (WB.equals(site)) return "wildberries.uz/catalog/123456/detail.aspx";
        return "uzum.uz/ru/product/название-123456";
    }

    /** Находит ссылку на товар в тексте. */
    public static Link parse(String text) throws Store.UserException {
        String t = text == null ? "" : text.trim();
        if (t.isEmpty()) throw new Store.UserException("Вставьте ссылку на товар.");
        String url, host;
        Matcher m = LINK.matcher(t);
        if (m.find()) {
            url = m.group();
            host = m.group(1);
        } else {
            Matcher b = BARE.matcher(t);
            if (!b.find()) throw new Store.UserException("Это не ссылка на Uzum, Ozon или Wildberries.");
            url = "https://" + b.group(1);
            host = b.group(2);
        }
        int hash = url.indexOf('#');
        if (hash >= 0) url = url.substring(0, hash);
        String site = siteOfHost(host);
        Matcher p = path(site).matcher(url);
        if (!p.find()) {
            throw new Store.UserException("Не похоже на ссылку товара. Нужна ссылка вида " + hint(site));
        }
        long productId;
        try {
            productId = Long.parseLong(p.group(1));
        } catch (NumberFormatException e) {
            throw new Store.UserException("Не похоже на ссылку товара. Нужна ссылка вида " + hint(site));
        }
        int q = url.indexOf('?');
        String path = q >= 0 ? url.substring(0, q) : url;
        if (WB.equals(site)) {
            // размер — отдельный товар для слежения: у размеров бывают разные цены и остатки
            long size = first(WB_SIZE, url);
            String base = "https://www.wildberries.uz/catalog/" + productId + "/detail.aspx";
            return new Link(site, size > 0 ? base + "?size=" + size : base, productId, size);
        }
        if (OZON.equals(site)) {
            // хвост после «?» сайт дописывает сам при каждом открытии — в ссылке он не нужен
            path = path.replaceFirst("^(?i)https?://(?:www\\.)?ozon\\.uz", "https://www.ozon.uz");
            while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
            return new Link(site, path + "/", productId, 0);
        }
        long sku = first(UZUM_SKU, url);
        path = path.replaceFirst("^(?i)https?://(?:www\\.)?uzum\\.uz", "https://uzum.uz");
        while (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        return new Link(site, sku > 0 ? path + "?skuId=" + sku : path, productId, sku);
    }

    private static long first(Pattern pattern, String url) {
        Matcher m = pattern.matcher(url);
        try {
            return m.find() ? Long.parseLong(m.group(1)) : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Номер товара, чья страница открыта, или -1. */
    public static long pageProductId(String site, String href) {
        String h = href == null ? "" : href;
        int hash = h.indexOf('#');
        if (hash >= 0) h = h.substring(0, hash);
        Matcher m = path(normalize(site)).matcher(h);
        try {
            return m.find() ? Long.parseLong(m.group(1)) : -1;
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** Вариант товара, который показывает открытая страница Uzum (skuId в адресе), или 0. */
    public static long pageSku(String href) {
        return first(UZUM_SKU, href == null ? "" : href);
    }

    /** Картинку показываем, только если она с адреса самого сайта. */
    public static boolean imageOk(String site, String url) {
        if (url == null) return false;
        String s = normalize(site);
        Pattern p = OZON.equals(s) ? OZON_IMAGE : WB.equals(s) ? WB_IMAGE : UZUM_IMAGE;
        return p.matcher(url).matches();
    }

    /** Скрипт из web/, которым читается карточка товара. */
    public static String extractFile(String site) {
        String s = normalize(site);
        return OZON.equals(s) ? "extract-ozon.js" : WB.equals(s) ? "extract-wb.js" : "extract.js";
    }

    /** Адрес принадлежит одному из поддерживаемых сайтов: только такие страницы приложение открывает само. */
    public static boolean allowed(String url) {
        try {
            Uri u = Uri.parse(url);
            String host = u.getHost();
            if (!"https".equals(u.getScheme()) || host == null) return false;
            for (String h : new String[]{"uzum.uz", "ozon.uz", "wildberries.uz"}) {
                if (host.equals(h) || host.endsWith("." + h)) return true;
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }
}
