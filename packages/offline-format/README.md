# 离线分发格式

网站、管理器和流水线共用的小型无依赖模块：

- platform：产品平台标识与 Node 运行平台转换。
- package-status：已发布/未验证包的下载状态判断。
- package-metadata、files：负载清单、摘要与完整性验证。
- manager-qualification：管理器正式发布必须满足的验收项。

格式行为保持原样，通过工作区包 @dsh-depot/offline-format 使用。管理器成品将需要的代码打入归档，安装设备无需安装这个工作区。
