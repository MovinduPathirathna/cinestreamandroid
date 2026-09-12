package com.cinestream.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import android.webkit.JavascriptInterface;

public class MainActivity extends Activity {
    private WebView webView;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        webView = new WebView(this);
        setContentView(webView);
        
        // Configure WebView for modern web apps
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        
        // TV specific settings
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);

        // Enable mixed-content for embed players (needed for some providers)
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        
        // Custom AdBlocking WebViewClient
        webView.setWebViewClient(new AdBlockWebViewClient());
        
        // Full WebChromeClient with video support (fullscreen, autoplay)
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(android.view.View view, CustomViewCallback callback) {
                // Allow native fullscreen video
                super.onShowCustomView(view, callback);
            }
        });
        
        // Inject Android Javascript Interface to close app
        webView.addJavascriptInterface(new AndroidBridge(), "Android");

        // Make sure WebView has focus so D-pad events are processed
        webView.requestFocus();
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        // Load the local HTML file
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    // JS Interface
    private class AndroidBridge {
        @JavascriptInterface
        public void closeApp() {
            finish();
        }
    }

    // Handle Fire TV Remote / D-Pad back button correctly
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Directly call the JS navigation handler in the TOP-LEVEL frame.
            // This bypasses the cross-origin iframe focus issue — the evaluateJavascript
            // call ALWAYS runs in the parent page context, not the iframe.
            webView.evaluateJavascript(
                "(function() {" +
                "  if (window.app && window.app.nav) {" +
                "    window.app.nav.handleBackKey();" +
                "  }" +
                "})();",
                null
            );
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    // Handle D-Pad key events and pass them to spatial navigation JS
    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        return super.onKeyUp(keyCode, event);
    }
    
    // -------------------------------------------------------------------------
    // NATIVE AD-BLOCKER
    // This intercepts every network request made by the WebView and blocks ads.
    // -------------------------------------------------------------------------
    private static class AdBlockWebViewClient extends WebViewClient {
        // List of known ad and popup domains used by VidSrc and other embeds
        private static final String[] AD_DOMAINS = {
            "doubleclick.net",
            "googlesyndication.com",
            "adnxs.com",
            "popads.net",
            "popcash.net",
            "exoclick.com",
            "adsterra.com",
            "propellerads.com",
            "trafficjunky.com",
            "hilltopads.com",
            "ad.js",
            "ads.js"
        };

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString().toLowerCase();
            
            // Check if the URL contains any of our ad domain substrings
            for (String adDomain : AD_DOMAINS) {
                if (url.contains(adDomain)) {
                    // Return an empty response (effectively blocking the ad)
                    return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream("".getBytes()));
                }
            }
            
            // Allow normal requests to pass through
            return super.shouldInterceptRequest(view, request);
        }
        
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Block all external navigations (popups/redirects)
            String url = request.getUrl().toString();
            if (url.startsWith("http") && !url.contains("vidsrc") && !url.contains("autoembed") && !url.contains("embed3") && !url.contains("2embed") && !url.contains("multiembed")) {
                return true; // Return true to cancel the navigation
            }
            return false;
        }
    }
}
