import { AppIntentManager, AppIntentProtocol, Widget, LiveActivity } from "scripting"
import { getReminders, notification } from "./model"
import { config } from "./config"


export const reminderLiveActivity = AppIntentManager.register({
    name: "reminderLiveActivity",
    protocol: AppIntentProtocol.AppIntent,
    perform: async (params: { identifier: string }) => {
        console.log("[Intent] 执行实时活动提醒，ID:", params.identifier)
        try {
            const reminders = await getReminders(1, true)
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

export const CompleteReminderIntent = AppIntentManager.register({
    name: "CompleteReminderIntent",
    protocol: AppIntentProtocol.LiveActivityIntent,
    perform: async (params: { reminderId: string; isCompleted: boolean }) => {
        notification("[Intent] 执行完成或取消提醒，ID:", params.reminderId, config.debug)
        try {
            const reminders = await getReminders(10, params.isCompleted)
            const target = reminders.find(r => r.identifier === params.reminderId)
            if (target) {
                target.isCompleted = !params.isCompleted
                notification("[Intent] 状态", String(target.isCompleted), config.debug)
                await target.save() // 保存提醒状态
                const liveActivity = await import("./live_activity") // 动态导入
                if (target.isCompleted) {
                    await liveActivity.endActivityByIdentifier(params.reminderId, config.liveActivityDismissTimeInterval) // 实时活动无法自我终结，秒
                }
                // else {
                //     const now = new Date()
                //     const defaultDueDate = new Date(now.getTime() + 30 * 60_000)
                //     // const title = '测试实时活动,测试实时活动'
                //     // const identifier = `test-activity-${dueDateObj.getTime()}`
                //     let dueDateObj: Date
                //     if (target.dueDateComponents?.date) {
                //         dueDateObj = typeof target.dueDateComponents.date === 'string' ? new Date(target.dueDateComponents.date) : target.dueDateComponents.date
                //         if (isNaN(dueDateObj.getTime())) dueDateObj = defaultDueDate
                //     } else {
                //         dueDateObj = defaultDueDate
                //     }
                //     if (dueDateObj < now) { dueDateObj = defaultDueDate } // 由于 TimerIntervalLabel 参数需要时间未到
                //     await liveActivity.updateActivity(target.identifier, target.title, dueDateObj, target.notes ?? '')
                // }
                notification("[Intent] 提醒已完成:", target.title, config.debug)
                HapticFeedback.notificationSuccess()
            } else {
                notification("[Intent] 未找到提醒，ID:", params.reminderId, config.debug)
                HapticFeedback.notificationError()
            }
        } catch (err) {
            notification("[Intent] 完成提醒异常:", String(err), config.debug)
            HapticFeedback.notificationError()
        }
        Widget.reloadAll()
    }
})

export const startLiveActivity = AppIntentManager.register({
    name: "startLiveActivity",
    protocol: AppIntentProtocol.LiveActivityIntent,
    perform: async (params: { title: string; identifier: string; dueDate: string; notes: string }) => {
        try {
            notification("[Intent] 尝试启动实时活动:", '', config.debug)
            const now = new Date()
            const defaultDueDate = new Date(now.getTime() + 30 * 60_000)
            // const title = '测试实时活动,测试实时活动'
            // const identifier = `test-activity-${dueDateObj.getTime()}`
            let dueDateObj: Date
            if (params.dueDate) {
                dueDateObj = typeof params.dueDate === 'string' ? new Date(params.dueDate) : params.dueDate
                if (isNaN(dueDateObj.getTime())) dueDateObj = defaultDueDate
            } else {
                dueDateObj = defaultDueDate
            }
            if (dueDateObj < now) { dueDateObj = defaultDueDate } // 由于 TimerIntervalLabel 参数需要时间未到
            const liveActivity = await import("./live_activity") // 动态导入
            await liveActivity.startReminderActivity(params.title!, params.identifier!, dueDateObj, params.notes)
        } catch (err) {
            notification("[Intent] 执行实时活动提醒异常:", String(err), config.debug)
        }
    }
})
