package expo.modules.voicealarmalarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * 알람 발화의 실제 동작 지점.
 *
 * 1. 즉시 startForeground() 로 자신을 포그라운드로 승격 (안 하면 몇 초 안에 시스템이 죽인다)
 * 2. 백그라운드 스레드에서 발화 직전 재검증 — 서버가 명시적으로 "무효"라고 답한 경우에만
 *    재생을 건너뛴다. 오프라인이면(응답을 못 받으면) 그냥 울린다 — 비행기 모드에서도
 *    알람이 울려야 한다는 요구사항 때문이다.
 * 3. 유효하면 STREAM_ALARM 으로 재생 + 풀스크린 알림으로 잠금 화면 위에 AlarmActivity 를 띄움
 *
 * ⚠️ 이 파일 전체가 실기기에서 검증되지 않았다.
 */
class AlarmForegroundService : Service() {
    private var mediaPlayer: MediaPlayer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val alarmId = intent?.getStringExtra(AlarmScheduler.EXTRA_ALARM_ID)

        when (intent?.action) {
            ACTION_STOP -> {
                if (alarmId != null) acknowledgeAndStop(alarmId, played = true)
                return START_NOT_STICKY
            }
            ACTION_SNOOZE -> {
                if (alarmId != null) snooze(alarmId)
                return START_NOT_STICKY
            }
        }

        if (alarmId == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        startForegroundCompat(buildRingingNotification(alarmId, ringing = false))
        verifyAndRing(alarmId)
        return START_NOT_STICKY
    }

    /** 백그라운드 스레드에서 서버 확인 → 메인 스레드에서 재생/정리. 네트워크 호출은 메인 스레드 금지. */
    private fun verifyAndRing(alarmId: String) {
        Thread {
            val store = AlarmStore(applicationContext)
            val alarm = store.get(alarmId)
            if (alarm == null) {
                mainHandler.post { stopSelf() }
                return@Thread
            }

            val client = AlarmApiClient(CredentialsStore(applicationContext))
            val result = client.checkValidity(alarmId)

            // result == null: 서버에 물어볼 수 없었다(오프라인 등) → 로컬 스케줄을 신뢰하고 울린다.
            // result.valid == false: 서버가 명시적으로 무효라고 답했다 → 울리지 않는다.
            val shouldRing = result == null || result.valid

            mainHandler.post {
                if (shouldRing) {
                    ring(alarm)
                } else {
                    store.remove(alarmId)
                    stopSelf()
                }
            }
        }.start()
    }

    private fun ring(alarm: AlarmData) {
        // 화면을 켜는 건 AlarmActivity 의 setTurnScreenOn()/setShowWhenLocked() 몫이다.
        // 여기서는 재생 중 CPU 가 잠들지 않게 PARTIAL_WAKE_LOCK 만 쥔다.
        wakeLock =
            (getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "voicealarm:alarm-ring")
                .apply { acquire(TEN_MINUTES_MS) }

        startForegroundCompat(buildRingingNotification(alarm.alarmId, ringing = true))

        mediaPlayer =
            MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                isLooping = true
                runCatching {
                    setDataSource(applicationContext, Uri.parse(alarm.audioFilePath))
                    prepare()
                    start()
                }
            }
    }

    private fun snooze(alarmId: String) {
        val store = AlarmStore(applicationContext)
        val alarm = store.get(alarmId) ?: return stopRingingAndSelf()

        val snoozed = alarm.copy(triggerAtMillis = System.currentTimeMillis() + FIVE_MINUTES_MS)
        store.put(snoozed)
        AlarmScheduler.schedule(applicationContext, snoozed)
        stopRingingAndSelf()
    }

    private fun acknowledgeAndStop(
        alarmId: String,
        played: Boolean,
    ) {
        AlarmStore(applicationContext).remove(alarmId)
        Thread {
            runCatching { AlarmApiClient(CredentialsStore(applicationContext)).ack(alarmId, played) }
        }.start()
        stopRingingAndSelf()
    }

    /**
     * Android 10(API 29)+ 는 포그라운드 서비스 타입을 startForeground() 호출 시점에도
     * 명시해야 한다(매니페스트 선언만으로는 부족하다). 14(API 34)+ 는 이걸 빼먹으면
     * MissingForegroundServiceTypeException 으로 죽는다.
     */
    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopRingingAndSelf() {
        mediaPlayer?.let {
            runCatching { it.stop() }
            it.release()
        }
        mediaPlayer = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        mediaPlayer?.release()
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private fun buildRingingNotification(
        alarmId: String,
        ringing: Boolean,
    ): Notification {
        ensureChannel()

        val fullScreenIntent =
            PendingIntent.getActivity(
                this,
                alarmId.hashCode(),
                Intent(this, AlarmActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra(AlarmScheduler.EXTRA_ALARM_ID, alarmId)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val builder =
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("VoiceAlarm")
                .setContentText(if (ringing) "알람이 울리고 있습니다" else "알람 확인 중…")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setOngoing(true)
                .setAutoCancel(false)

        if (ringing) {
            // fullScreenIntent 가 있는 고중요도 알림이어야 시스템이 잠금 화면 위로
            // AlarmActivity 를 직접 띄워 준다 — 이게 안드로이드가 문서화한 "알람 화면" 패턴이다.
            builder.setFullScreenIntent(fullScreenIntent, true)
            builder.setContentIntent(fullScreenIntent)
        }

        return builder.build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel =
            NotificationChannel(CHANNEL_ID, "알람", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "음성 알람 발화"
                // 알람 채널 자체는 무음으로 둔다 — 실제 소리는 MediaPlayer 로 STREAM_ALARM 재생한다.
                // 채널 사운드까지 겹치면 두 소리가 동시에 난다.
                setSound(null, null)
                enableVibration(true)
            }
        manager.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_FIRE = "expo.modules.voicealarmalarm.action.FIRE"
        const val ACTION_STOP = "expo.modules.voicealarmalarm.action.STOP"
        const val ACTION_SNOOZE = "expo.modules.voicealarmalarm.action.SNOOZE"

        private const val CHANNEL_ID = "voicealarm_alarm"
        private const val NOTIFICATION_ID = 7801
        private const val FIVE_MINUTES_MS = 5 * 60 * 1000L
        private const val TEN_MINUTES_MS = 10 * 60 * 1000L
    }
}
