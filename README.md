# 漫画日语课

每天一页的日语学习网站，部署在 japanese.fttool.cn。

- `public/` 是网站本身。`public/index.html` 是页面程序；`public/lessons/YYYY-MM-DD.json` 是每天的课，`public/lessons/index.json` 是课程目录。
- 每天新增一课：加一个课程文件，并在目录里加一条。`public/lessons/example.json` 是格式样板。
- `server/setup.sh` 是服务器的一次性安装脚本：克隆本仓库到 `/opt/japanese-site`，每分钟从 GitHub 拉取一次，并添加 Apache 虚拟主机。

笔顺数据来自 AnimCJK（Arphic Public License），笔顺动画使用 Hanzi Writer（MIT），见 `public/licenses.txt`。
