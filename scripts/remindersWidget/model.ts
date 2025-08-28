import { Notification, VStack, Text, Button } from 'scripting'

export async function getReminders(limit: number = 1, isCompleted: boolean) {
    console.log("[Model] 获取近期的提醒事项:", limit);
    try {
        const now = new Date();
        const beforeIn = new Date(now.getTime() - 10080 * 60000); // 7 天前
        const before = new Date(now.getTime() - 1440 * 60000);   // 1 天前
        // const after = new Date(now.getTime() + 1440 * 60000);     // 1 天后
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        // 设置时间为明天凌晨3点0分0秒0毫秒
        tomorrow.setHours(3, 0, 0, 0);
        const afterIn = tomorrow;  // 动态获取明天凌晨3点

        const all = isCompleted
            ? await Reminder.getCompleteds({ startDate: before, endDate: afterIn })
            : await Reminder.getIncompletes({ endDate: afterIn });

        // 使用 dueDateComponents?.date 代替 dueDate
        const filtered = all.filter(r => r.dueDateComponents?.date);

        const sorted = filtered.sort((a, b) => {
            const dateA = a.dueDateComponents?.date?.getTime() ?? 0;
            const dateB = b.dueDateComponents?.date?.getTime() ?? 0;
            return dateA - dateB;
        });

        console.log("[Model] 获取到提醒条数:", sorted.length);
        return sorted.slice(0, limit);

    } catch (err) {
        console.error("[Model] 获取提醒异常:", err);
        return [];
    }
}


export function formatTime(date?: Date) {
    if (!date) return ""
    return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes()
        .toString()
        .padStart(2, "0")}`
}

export function notification(name: string, content: string, debug: boolean = false) {
    if (debug) {
        Notification.schedule({
            title: name,
            body: content,
            threadIdentifier: name,
            avoidRunningCurrentScriptWhenTapped: true,
            // customUI: true,
        });
    } else {
        console.log(`[Debug Notification] ${name}: ${content}`)
    }
}
