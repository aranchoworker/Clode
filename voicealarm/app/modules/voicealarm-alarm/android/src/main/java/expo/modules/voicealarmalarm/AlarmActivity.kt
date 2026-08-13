package expo.modules.voicealarmalarm

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * 발화 화면. 잠금 화면 위에 직접 뜬다.
 *
 * AlarmForegroundService 가 fullScreenIntent 알림으로 이 액티비티를 띄운다. 여기서는
 * 재생/네트워크를 직접 하지 않는다 — 버튼을 누르면 서비스에 Intent 로 액션만 보내고,
 * 실제 정지/재시도/재검증은 전부 서비스 쪽 책임으로 남긴다(화면 회전·프로세스 재시작에
 * 강하게 만들기 위해서다).
 */
class AlarmActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowOverLockScreen()
        setContentView(R.layout.activity_alarm)

        val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID)
        if (alarmId == null) {
            finish()
            return
        }

        val alarm = AlarmStore(applicationContext).get(alarmId)
        findViewById<TextView>(R.id.senderNameText).text = alarm?.senderName ?: "VoiceAlarm"
        findViewById<TextView>(R.id.titleText).text = alarm?.title.orEmpty()

        findViewById<android.widget.Button>(R.id.snoozeButton).setOnClickListener {
            sendServiceAction(alarmId, AlarmForegroundService.ACTION_SNOOZE)
            finish()
        }
        findViewById<android.widget.Button>(R.id.dismissButton).setOnClickListener {
            sendServiceAction(alarmId, AlarmForegroundService.ACTION_STOP)
            finish()
        }
    }

    /** 뒤로가기로 알람을 조용히 넘겨버릴 수 없게 막는다. 반드시 버튼으로 처리해야 한다. */
    override fun onBackPressed() {
        // no-op
    }

    private fun sendServiceAction(
        alarmId: String,
        action: String,
    ) {
        val intent =
            Intent(this, AlarmForegroundService::class.java).apply {
                this.action = action
                putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
            }
        startService(intent)
    }

    private fun setShowOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            )
        }
    }
}
