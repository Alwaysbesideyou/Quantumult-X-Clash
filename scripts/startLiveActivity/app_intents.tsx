import { AppIntentManager, AppIntentProtocol, Widget, LiveActivity } from "scripting"
import { getReminders, notification } from "./model"
import { config } from "./config"

export const reminderLiveActivity = AppIntentManager.register({
    name: "reminderLiveActivity",
    protocol: AppIntentProtocol.AppIntent,
    perform: async (params: { identifier: string }) => {
        console.log("[Intent] 执行实时活动提醒，ID:", params.identifier)
        try {
            const reminders = await getReminders(1, false)
            const target = reminders.find(r => r.identifier === params.identifier)
            if (target) {
                console.log("[Intent] 实时活动提醒:", target.title)
                Widget.reloadAll()
            } else {
                notification("[Intent] 未找到实时活动提醒，ID:", params.identifier, config.debug)
            }
        } catch (err) {
            notification("[Intent] 执行实时活动提醒异常:", String(err), config.debug)
        }
    }
})

export const testNotify = AppIntentManager.register({
    name: "notify",
    protocol: AppIntentProtocol.AppIntent,
    perform: async (content: string) => {
        try {
            notification("Live Activity", content)
            console.log("[Intent] 执行通知:")
            HapticFeedback.notificationSuccess()
            Widget.reloadAll()
        } catch (err) {
            notification("[Intent] 执行通知异常:", String(err), config.debug)
            HapticFeedback.notificationError()
        }
    }
})

export const widgetReloadAll = AppIntentManager.register({
    name: "widgetReloadAll",
    protocol: AppIntentProtocol.AppIntent,
    perform: async (params: undefined) => {
        try {
            console.log("[Intent] 执行小组件重载:")
            notification("Widget", "小组件已重载")
            Widget.reloadAll()
            HapticFeedback.notificationSuccess()
        } catch (err) {
            notification("[Intent] 执行小组件重载异常:", String(err), config.debug)
            HapticFeedback.notificationError()
        }
    }
})

// export const CompleteReminderIntent = AppIntentManager.register({
//     name: "CompleteReminderIntent",
//     protocol: AppIntentProtocol.LiveActivityIntent,
//     perform: async (reminderId: string) => {
//         console.log("[Intent] 执行完成提醒，ID:", reminderId)
//         try {
//             const liveActivity = await import("./live_activity") // 动态导入
//             await liveActivity.endActivityByIdentifier(reminderId) // 实时活动无法自我终结
//             const reminders = await getReminders(10, false)
//             const target = reminders.find((r) => r.identifier === reminderId)
//             if (target) {
//                 target.isCompleted = true
//                 await target.save()
//                 const liveActivity = await import("./live_activity") // 动态导入
//                 await liveActivity.endActivityByIdentifier(reminderId) // 实时活动无法自我终结
//                 notification("[Intent] 提醒已完成:", target.title, debug)
//                 // 触发震动反馈（需导入 HapticFeedback）
//                 HapticFeedback.notificationSuccess()
//             } else {
//                 notification("[Intent] 未找到提醒，ID:", reminderId, debug)
//                 HapticFeedback.notificationError()
//             }
//         } catch (err) {
//             notification("[Intent] 完成提醒异常:", String(err), debug)
//             HapticFeedback.notificationError()
//         }
//         Widget.reloadAll()
//     },
// })

export const CompleteReminderIntent = AppIntentManager.register({
    name: "CompleteReminderIntent",
    protocol: AppIntentProtocol.LiveActivityIntent,
    perform: async (args: { reminderId: string; isCompleted: boolean }) => {
        console.log("[Intent] 执行完成提醒，ID:", args.reminderId)
        try {
            const reminders = await getReminders(10, args.isCompleted)
            const target = reminders.find(r => r.identifier === args.reminderId)
            if (target) {
                target.isCompleted = true
                await target.save() // 保存提醒状态
                const liveActivity = await import("./live_activity") // 动态导入
                await liveActivity.endActivityByIdentifier(args.reminderId, config.liveActivityDismissTimeInterval) // 实时活动无法自我终结，秒
                notification("[Intent] 提醒已完成:", target.title, config.debug)
                HapticFeedback.notificationSuccess()
            } else {
                notification("[Intent] 未找到提醒，ID:", args.reminderId, config.debug)
                HapticFeedback.notificationError()
            }
        } catch (err) {
            notification("[Intent] 完成提醒异常:", String(err), config.debug)
            HapticFeedback.notificationError()
        }
        Widget.reloadAll()
    }
})
