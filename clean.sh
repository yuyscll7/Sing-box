#!/bin/bash

# 获取当前用户名
USER=$(whoami)

# 删除特定网站配置
devil www del "${USER}.serv00.net"
devil www del "keep.${USER}.serv00.net"

# 递归删除 /home/$USER/domains 目录下的所有内容
rm -rf "/home/$USER/domains/*"

# 启用扩展模式匹配和隐藏文件匹配
shopt -s extglob dotglob

# 递归删除 /home/$USER 目录下除某些特定目录外的所有内容
rm -rf "/home/$USER/!(domains|mail|repo|backups)"
