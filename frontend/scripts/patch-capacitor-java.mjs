import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

const targets = [
  "node_modules/@capacitor/android/capacitor/build.gradle",
  "android/app/capacitor.build.gradle",
  "android/capacitor-cordova-android-plugins/build.gradle",
];

for (const relativePath of targets) {
  const filePath = path.join(root, relativePath);
  if (!existsSync(filePath)) {
    continue;
  }

  const original = readFileSync(filePath, "utf8");
  let patched = original.replaceAll("JavaVersion.VERSION_21", "JavaVersion.VERSION_17");

  if (relativePath === "node_modules/@capacitor/android/capacitor/build.gradle") {
    patched = patched
      .replace('url "https://plugins.gradle.org/m2/"', 'url = "https://plugins.gradle.org/m2/"')
      .replace('namespace "com.getcapacitor.android"', 'namespace = "com.getcapacitor.android"')
      .replace("compileSdk project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 35", "compileSdk = project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 35")
      .replace("minSdkVersion project.hasProperty('minSdkVersion') ? rootProject.ext.minSdkVersion : 23", "minSdkVersion = project.hasProperty('minSdkVersion') ? rootProject.ext.minSdkVersion : 23")
      .replace("targetSdkVersion project.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 35", "targetSdkVersion = project.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 35")
      .replace("versionCode 1", "versionCode = 1")
      .replace('versionName "1.0"', 'versionName = "1.0"')
      .replace('testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"', 'testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"')
      .replace("minifyEnabled false", "minifyEnabled = false")
        .replace("lintOptions {", "lint {")
      .replace('baseline file("lint-baseline.xml")', 'baseline = file("lint-baseline.xml")')
      .replace("abortOnError true", "abortOnError = true")
      .replace("warningsAsErrors true", "warningsAsErrors = true")
      .replace("lintConfig file('lint.xml')", "lintConfig = file('lint.xml')");
  }

  if (relativePath === "android/capacitor-cordova-android-plugins/build.gradle") {
    patched = patched
      .replace('namespace "capacitor.cordova.android.plugins"', 'namespace = "capacitor.cordova.android.plugins"')
      .replace("compileSdk project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 35", "compileSdk = project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 35")
      .replace("minSdkVersion project.hasProperty('minSdkVersion') ? rootProject.ext.minSdkVersion : 23", "minSdkVersion = project.hasProperty('minSdkVersion') ? rootProject.ext.minSdkVersion : 23")
      .replace("targetSdkVersion project.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 35", "targetSdkVersion = project.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 35")
      .replace("versionCode 1", "versionCode = 1")
      .replace('versionName "1.0"', 'versionName = "1.0"')
        .replace("lintOptions {", "lint {")
      .replace("abortOnError false", "abortOnError = false");
  }

  if (patched !== original) {
    writeFileSync(filePath, patched);
  }
}