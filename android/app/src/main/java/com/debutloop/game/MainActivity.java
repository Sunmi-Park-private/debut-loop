package com.debutloop.game;

import android.os.Bundle;
import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    applyImmersive();
  }

  // 포커스 복귀(홈에서 돌아오기, 알림창 닫기 등) 시 몰입 모드 재적용
  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) applyImmersive();
  }

  /** 게임 몰입 모드: 상태바·내비게이션 바 숨김, 가장자리 스와이프 시에만 잠깐 표시 */
  private void applyImmersive() {
    Window window = getWindow();
    WindowCompat.setDecorFitsSystemWindows(window, false);
    View decor = window.getDecorView();
    WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, decor);
    controller.hide(WindowInsetsCompat.Type.systemBars());
    controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
  }
}
