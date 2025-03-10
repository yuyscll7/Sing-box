#!/bin/bash

# 获取当前用户名
USER=$(whoami)

# 定义域名
DOMAIN1="${USER}.serv00.net"
DOMAIN2="keep.${USER}.serv00.net"

# 删除特定网站配置
purple "Deleting website configuration for $DOMAIN1..."
devil www del "$DOMAIN1"
if [ $? -eq 0 ]; then
    green "Successfully deleted website configuration for $DOMAIN1"
else
    red "Failed to delete website configuration for $DOMAIN1"
fi

purple "Deleting website configuration for $DOMAIN2..."
devil www del "$DOMAIN2"
if [ $? -eq 0 ]; then
    green "Successfully deleted website configuration for $DOMAIN2"
else
    red "Failed to delete website configuration for $DOMAIN2"
fi

# 递归删除 /home/$USER/domains 目录下的所有内容
purple "Removing all contents in /home/$USER/domains/..."
rm -rf "/home/$USER/domains/*"
if [ $? -eq 0 ]; then
    green "Successfully removed all contents in /home/$USER/domains/"
else
    red "Failed to remove all contents in /home/$USER/domains/"
fi

# 启用扩展模式匹配和隐藏文件匹配
shopt -s extglob dotglob

# 递归删除 /home/$USER 目录下除某些特定目录外的所有内容
purple "Removing all contents in /home/$USER except domains, mail, repo, and backups..."
rm -rf "/home/$USER/!(domains|mail|repo|backups)"
if [ $? -eq 0 ]; then
    green "Successfully removed all contents in /home/$USER except domains, mail, repo, and backups"
else
    red "Failed to remove all contents in /home/$USER except domains, mail, repo, and backups"
fi



