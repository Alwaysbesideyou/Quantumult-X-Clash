import { VStack, HStack, Text, Button, Widget, gradient, Spacer, Rectangle, Link, Image, Toggle } from "scripting"
import { reminderLiveActivity, testNotify, widgetReloadAll, CompleteReminderIntent, startLiveActivity } from "./app_intents"
import { getReminders, formatTime, notification } from "./model"

export async function ReminderWidgetView() {
  console.log("[Widget] 渲染小组件视图")
  try {
    const reminders = await getReminders(5, false)
    console.log("[Widget] 获取提醒数量:", reminders.length)
    const now = new Date()
    const displayReminders = reminders.slice(0, 3);
    // if (!reminders.length) {
    //   return (
    //     <VStack>
    //       <Text>暂无未完成提醒</Text>
    //     </VStack>
    //   )
    // }

    return (
      <VStack
        alignment={"leading"}
        frame={{ maxWidth: Infinity, maxHeight: Infinity, alignment: "topLeading" }}
        widgetBackground={gradient("linear", {
          colors: ["#2C2C2EFF", "#1C1C1EFF"],
          startPoint: "top",
          endPoint: "bottom",
        })}
      >
        {/* 固定标题栏 */}
        <HStack alignment={"center"} padding={{ top: 8, bottom: 0 }}>
          <Button
            title={`近期`}
            intent={widgetReloadAll(undefined)}
            // intent={testNotify(r.identifier)}
            // widgetAccentable
            foregroundStyle="#E74C3CFF"
            font={16}
            bold={true}
            padding={{ leading: 16, top: 0, bottom: 0 }}
            buttonStyle="borderless"
            controlSize="regular"
          />
          {/* <Text
            widgetAccentable
            foregroundStyle="red"
            font={16}
            bold={true}
            padding={{ leading: 16 }}
          >
            未完成{now.getSeconds()}
          </Text> */}
          <Spacer />
          <Link
            url={`x-apple-reminderkit://`} // 打开提醒详情
            foregroundStyle="white"
            font={24}
            bold={true}
            padding={{ trailing: 16, top: 0, bottom: 0 }}
          >
            {`${reminders.length}`}
          </Link>
        </HStack>
        {/* 限制显示最多三条提醒 */}
        {reminders.length !== 0 ? displayReminders.map((r, index) => (
          <VStack key={r.identifier} alignment="leading" spacing={6} padding={{ leading: 10, top: -8 }}>
            <HStack spacing={4} alignment="center">
              {/* <Link url={`scripting://run/startLiveActivity?title=${r.title}&identifier=${r.identifier}&dueDate=${r.dueDateComponents?.date}${r.notes ? '&note=' + r.notes : ''}`} // 打开实时活动
                padding={{ leading: 18, trailing: 0, top: 2, bottom: 2 }}
                frame={{ width: 24, height: 26 }}>
                {<Image font={24} foregroundStyle="#EBEBF599" systemName={"circle.dotted"} symbolRenderingMode="multicolor" padding={{ trailing: 16 }} />}
              </Link> */}
              <Button
                padding={{ leading: 12, trailing: 0, top: 2, bottom: 2 }}
                frame={{ width: 24, height: 28 }}
                title=""
                // value={r.isCompleted}
                intent={CompleteReminderIntent({ reminderId: r.identifier, isCompleted: r.isCompleted })} // 触发带参数的 AppIntent
                font={24}
                foregroundStyle="#EBEBF599"
                systemImage="circle.dotted"
                buttonStyle="plain"
              />
              {/* `x-apple-reminderkit://REMCDReminder/${r.identifier}` */}
              {/* <Link url={`scripting://run/startLiveActivity?title=${r.title}&identifier=${r.identifier}&dueDate=${r.dueDateComponents?.date}${r.notes ? '&note=' + r.notes : ''}`} // 打开提醒详情
                font={15}
                lineLimit={
                  displayReminders.length === 1
                    ? 5 // 如果只有一条提醒，允许更多行
                    : displayReminders.length === 2
                      ? 2 // 如果有两条提醒，允许中等行数
                      : 1
                }
                truncationMode="tail"
                padding={{ leading: 5, trailing: -4, top: 0 }}
              // frame={{ width: index === 0 ? 85 : 100 }}
              >
                {`${r.title}`}
              </Link> */}
              <Button
                padding={{ leading: 5, trailing: -4, top: 0 }}
                truncationMode="tail"
                title={`${r.title}`}
                intent={startLiveActivity({ title: r.title, identifier: r.identifier, dueDate: String(r.dueDateComponents?.date), notes: r.notes ? r.notes : '' })} // 触发带参数的 AppIntent
                font={15}
                lineLimit={
                  displayReminders.length === 1
                    ? 5 // 如果只有一条提醒，允许更多行
                    : displayReminders.length === 2
                      ? 2 // 如果有两条提醒，允许中等行数
                      : 1
                }
                // systemImage="circle.dotted"
                buttonStyle="plain"
              />
              <Spacer />
              {(
                r.dueDateComponents?.date &&
                (r.dueDateComponents.date.getTime() - now.getTime()) <= 30 * 60 * 1000
              ) ? (
                <Link url={`x-apple-reminderkit://REMCDReminder/${r.identifier}/details`}>
                  <Image
                    font={16}
                    systemName={"clock"}
                    symbolRenderingMode="multicolor"
                    padding={{ leading: -10, trailing: 12 }}
                  />
                </Link>
              ) : null}
            </HStack>
            {/*分割线 */}
            {index < displayReminders.length - 1 ? (
              <HStack padding={{ leading: 35, top: -4 /* 按钮宽度+间距 */ }}>
                <Rectangle
                  frame={{ height: 0.25 }} // 设置分割线高度
                  stroke={{
                    shapeStyle: "#AAAAAA",
                    strokeStyle: {
                      dash: [1.5, 1.5]  // 这将创建虚线效果
                    }
                  }}
                  opacity={0.3} // 这里设置透明度
                  padding={{ leading: 0, trailing: 10 }}
                />
                <Spacer />
              </HStack>
            ) : null}
          </VStack>
        ))
          : (
            <VStack alignment="leading" padding={{ leading: 10, top: 0 }}>
              <HStack alignment="center">
                <Text font={15}
                  padding={{ leading: 6, trailing: 5, top: -8, bottom: 5 }}
                  foregroundStyle="#AAAAAA"
                >❤️没有提醒事项</Text>
                <Spacer />
              </HStack>
              <Spacer />
            </VStack>
          )}
      </VStack>
    )
  } catch (err) {
    console.error("[Widget] 渲染异常:", err)
    return (
      <VStack>
        <Text>加载失败</Text>
      </VStack>
    )
  }
}

(async () => {
  console.log("[Widget] 预览小组件")
  const view = await ReminderWidgetView()
  Widget.present(view, {
    policy: "after",
    date: new Date(Date.now() + 1000 * 60 * 5) // 5分钟后刷新
  })
})()
