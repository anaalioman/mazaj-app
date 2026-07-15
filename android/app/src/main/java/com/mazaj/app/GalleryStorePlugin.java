package com.mazaj.app;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * Saves a PNG snapshot into the device's real, public Pictures/مزاج album via
 * MediaStore — survives app uninstall, unlike @capacitor-community/media's
 * fixed getExternalMediaDirs() path (Android/media/<package>/, wiped by the
 * system on uninstall the same as private app storage).
 *
 * On Android 10+ (API 29+, scoped storage) inserting a brand-new item into
 * MediaStore.Images requires zero permissions — an app never needs
 * permission to create its own new content, only to touch files it doesn't
 * own. Only this app's minSdkVersion floor (24-28, pre-scoped-storage)
 * needs a runtime WRITE_EXTERNAL_STORAGE grant, which is why the manifest
 * declares that permission with maxSdkVersion="28" only.
 */
@CapacitorPlugin(
    name = "GalleryStore",
    permissions = { @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "legacyStorage") }
)
public class GalleryStorePlugin extends Plugin {
    private static final String ALBUM_NAME = "مزاج";

    @PluginMethod
    public void savePhoto(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q || getPermissionState("legacyStorage") == PermissionState.GRANTED) {
            doSave(call);
        } else {
            bridge.saveCall(call);
            requestAllPermissions(call, "permissionCallback");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState("legacyStorage") != PermissionState.GRANTED) {
            call.reject("تم رفض إذن التخزين اللازم على هذا الإصدار من أندرويد.", "accessDenied");
            return;
        }
        doSave(call);
    }

    private void doSave(PluginCall call) {
        String dataUrl = call.getString("dataUrl");
        if (dataUrl == null || !dataUrl.startsWith("data:")) {
            call.reject("dataUrl (base64 data: URL) مطلوب", "argumentError");
            return;
        }

        byte[] bytes;
        try {
            String base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("تعذّر فك ترميز الصورة", "argumentError");
            return;
        }

        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmssSSS").format(new Date());
        String fileName = call.getString("fileName", "mazaj_" + timeStamp) + ".png";

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveViaMediaStoreScoped(bytes, fileName);
            } else {
                saveLegacy(bytes, fileName);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("فشل حفظ الصورة: " + e.getMessage(), "filesystemError");
        }
    }

    /** API 29+: insert a brand-new MediaStore item — no permission needed. */
    private void saveViaMediaStoreScoped(byte[] bytes, String fileName) throws Exception {
        Context context = getContext();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM_NAME);
        values.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri item = context.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (item == null) throw new Exception("تعذّر إنشاء سجل الصورة في MediaStore");

        try (OutputStream out = context.getContentResolver().openOutputStream(item)) {
            if (out == null) throw new Exception("تعذّر فتح مجرى الكتابة");
            out.write(bytes);
        }

        values.clear();
        values.put(MediaStore.Images.Media.IS_PENDING, 0);
        context.getContentResolver().update(item, values, null, null);
    }

    /** API 24-28: write the public file directly, then index it via MediaStore. */
    private void saveLegacy(byte[] bytes, String fileName) throws Exception {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM_NAME);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("تعذّر إنشاء مجلد الألبوم");

        File outFile = new File(dir, fileName);
        try (FileOutputStream fos = new FileOutputStream(outFile)) {
            fos.write(bytes);
        }

        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        values.put(MediaStore.Images.Media.DATA, outFile.getAbsolutePath());
        getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
    }
}
