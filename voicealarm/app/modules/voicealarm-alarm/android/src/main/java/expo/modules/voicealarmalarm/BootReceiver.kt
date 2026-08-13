package expo.modules.voicealarmalarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 재부팅(또는 앱 업데이트) 후 AlarmManager 에 등록해 둔 알람이 전부 사라진다.
 * AlarmStore 에 남아 있는, 아직 지나지 않은 알람만 골라서 다시 등록한다.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(
        context: Context,
        intent: Intent,
    ) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        val store = AlarmStore(context.applicationContext)
        val now = System.currentTimeMillis()

        store.all().forEach { alarm ->
            if (alarm.triggerAtMillis > now) {
                AlarmScheduler.schedule(context.applicationContext, alarm)
            } else {
                // 재부팅하는 동안 지나가 버린 알람. 뒤늦게 울리면 오히려 당황스러우니 정리만 한다.
                store.remove(alarm.alarmId)
            }
        }
    }
}
