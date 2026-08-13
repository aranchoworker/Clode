package expo.modules.voicealarmalarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * AlarmManager 등록/취소를 한 곳에 모은다. scheduleAlarm()(모듈 진입점)과
 * BootReceiver(재부팅 후 복구) 둘 다 여기를 거친다 — 등록 로직이 두 곳에 따로 있으면
 * 언젠가 미묘하게 달라진다.
 */
object AlarmScheduler {
    const val EXTRA_ALARM_ID = "expo.modules.voicealarmalarm.ALARM_ID"

    /**
     * setAlarmClock() 을 쓴다. Doze/앱 대기 모드를 완전히 우회하는 유일한 공개 API 이고,
     * 시스템이 이 앱을 "곧 알람이 울릴 예정"으로 인식해 프로세스를 더 봐준다.
     * setExactAndAllowWhileIdle() 은 시스템이 배치로 묶어 지연시킬 수 있어 알람 앱에는 부적합하다.
     */
    fun schedule(
        context: Context,
        alarm: AlarmData,
    ) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val showIntent =
            PendingIntent.getActivity(
                context,
                alarm.alarmId.hashCode(),
                Intent(context, AlarmActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra(EXTRA_ALARM_ID, alarm.alarmId)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        alarmManager.setAlarmClock(
            AlarmManager.AlarmClockInfo(alarm.triggerAtMillis, showIntent),
            firingPendingIntent(context, alarm.alarmId),
        )
    }

    fun cancel(
        context: Context,
        alarmId: String,
    ) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.cancel(firingPendingIntent(context, alarmId))
    }

    private fun firingPendingIntent(
        context: Context,
        alarmId: String,
    ): PendingIntent {
        val intent =
            Intent(context, AlarmReceiver::class.java).apply {
                putExtra(EXTRA_ALARM_ID, alarmId)
            }
        return PendingIntent.getBroadcast(
            context,
            alarmId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
