package uz.pricewatch.monitor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Обычный экран с сайтом Uzum: здесь пользователь сам входит в свой аккаунт.
 * Мост window.Android сюда не подключается — приложение не видит ни номер, ни код из СМС;
 * сохраняется только сессия сайта (cookie), как в любом браузере.
 */
public class BrowserActivity extends Activity {

    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        float d = getResources().getDisplayMetrics().density;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#7000FF"));
        int pad = (int) (10 * d);
        bar.setPadding(pad * 2, pad / 2, pad, pad / 2);

        TextView title = new TextView(this);
        title.setText("Войдите в аккаунт Uzum, затем нажмите «Готово»");
        title.setTextColor(Color.WHITE);
        title.setTextSize(13);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button done = new Button(this);
        done.setText("Готово");
        done.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        bar.addView(done, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                // остаёмся внутри: ссылки «открыть в приложении» и прочие не-веб схемы не выполняем
                return !("https".equals(scheme) || "http".equals(scheme));
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        String url = getIntent().getStringExtra("url");
        if (url == null || !isUzum(url)) url = "https://uzum.uz/ru";
        web.loadUrl(url);
    }

    public static boolean isUzum(String url) {
        try {
            Uri u = Uri.parse(url);
            String host = u.getHost();
            return "https".equals(u.getScheme()) && host != null
                    && (host.equals("uzum.uz") || host.endsWith(".uzum.uz"));
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else finish();
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
