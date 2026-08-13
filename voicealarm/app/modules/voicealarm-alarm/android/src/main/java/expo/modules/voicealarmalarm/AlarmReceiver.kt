package expo.modules.voicealarmalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * AlarmManager 가 예약 시각에 발화시키는 지점.
 *
 * BroadcastReceiver.onReceive() 는 실행 시간이 몇 초로 제한돼 있어서(대략 10초),
 * 여기서 네트워크 재검증이나 오디오 재생을 직접 하면 안 된다. 포그라운드 서비스를
 * 띄우기만 하고 나머지는 그쪽에 맡긴다.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        val alarmId = intent.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID) ?: return

        val serviceIntent =
            Intent(context, AlarmForegroundService::class.java).apply {
                action = AlarmForegroundService.ACTION_FIRE
                putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
            }
        context.startForegroundService(serviceIntent)
    }
}
