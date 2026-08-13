package expo.modules.voicealarmalarm

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ScheduleAlarmInput : Record {
    @Field
    var alarmId: String = ""

    @Field
    var triggerAtMillis: Long = 0L

    @Field
    var audioFileUri: String = ""

    @Field
    var senderName: String = ""

    @Field
    var title: String = ""
}

class SetCredentialsInput : Record {
    @Field
    var apiBaseUrl: String = ""

    @Field
    var accessToken: String = ""

    @Field
    var refreshToken: String = ""
}

/**
 * JS ↔ 네이티브 경계. 실제 로직은 전부 다른 클래스(AlarmScheduler, AlarmStore,
 * CredentialsStore)에 있고, 여기서는 JS 가 부를 수 있는 함수 이름과 인자 타입만 정의한다.
 */
class VoicealarmAlarmModule : Module() {
    private val context: Context
        get() = appContext.reactContext ?: throw Exceptions.AppContextLost()

    override fun definition() =
        ModuleDefinition {
            Name("VoicealarmAlarm")

            AsyncFunction("scheduleAlarm") { input: ScheduleAlarmInput ->
                val alarm =
                    AlarmData(
                        alarmId = input.alarmId,
                        triggerAtMillis = input.triggerAtMillis,
                        audioFilePath = input.audioFileUri,
                        senderName = input.senderName,
                        title = input.title,
                    )
                AlarmStore(context).put(alarm)
                AlarmScheduler.schedule(context, alarm)
            }

            AsyncFunction("cancelAlarm") { alarmId: String ->
                AlarmStore(context).remove(alarmId)
                AlarmScheduler.cancel(context, alarmId)
                // 지금 이 알람이 울리고 있는 중에 취소됐을 수도 있다(예: 예약 후 바로 차단).
                // 발화 서비스가 떠 있다면 같이 정리한다.
                val stopIntent =
                    Intent(context, AlarmForegroundService::class.java).apply {
                        action = AlarmForegroundService.ACTION_STOP
                        putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
                    }
                context.startService(stopIntent)
            }

            AsyncFunction("isExactAlarmPermissionGranted") {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
                    true
                } else {
                    (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager)
                        .canScheduleExactAlarms()
                }
            }

            Function("openExactAlarmSettings") {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    openSettings(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
                }
            }

            Function("openBatteryOptimizationSettings") {
                val intent =
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${context.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                runCatching { context.startActivity(intent) }
            }

            Function("setCredentials") { input: SetCredentialsInput ->
                CredentialsStore(context).save(
                    CredentialsStore.Credentials(
                        apiBaseUrl = input.apiBaseUrl,
                        accessToken = input.accessToken,
                        refreshToken = input.refreshToken,
                    ),
                )
            }

            Function("clearCredentials") {
                CredentialsStore(context).clear()
            }
        }

    private fun openSettings(action: String) {
        val intent =
            Intent(action).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        runCatching { context.startActivity(intent) }
    }
}
