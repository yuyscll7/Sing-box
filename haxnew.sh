#!/bin/bash

# ==============================================
# 初始化配置：修复主机名解析问题
# ==============================================
echo "▹ 初始化系统配置..."
CURRENT_HOSTNAME=$(hostname)
echo "▷ 当前主机名: $CURRENT_HOSTNAME"

# 修复/etc/hosts配置
sudo sed -i "/$CURRENT_HOSTNAME/d" /etc/hosts
echo "127.0.0.1 localhost" | sudo tee /etc/hosts > /dev/null
echo "127.0.1.1 $CURRENT_HOSTNAME" | sudo tee -a /etc/hosts > /dev/null
echo "::1 localhost ip6-localhost ip6-loopback" | sudo tee -a /etc/hosts > /dev/null
echo "✔ 主机名解析配置完成"

# ==============================================
# 操作系统检测
# ==============================================
echo "▹ 正在检测操作系统..."
OS=""
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
elif [ -f /etc/centos-release ]; then
    OS="centos"
elif [ -f /etc/alpine-release ]; then
    OS="alpine"
else
    echo "✘ 错误：不支持的操作系统"
    exit 1
fi
echo "✔ 检测到系统: $OS"

# ==============================================
# 语言环境配置
# ==============================================
configure_locale() {
    echo "▹ 正在配置系统语言环境..."
    
    # 安装必要组件
    case $OS in
        debian|ubuntu)
            sudo apt-get update > /dev/null
            sudo apt-get install -y locales > /dev/null
            ;;
        centos)
            sudo yum install -y glibc-common > /dev/null
            ;;
        alpine)
            sudo apk add --no-cache musl-locales > /dev/null
            ;;
    esac

    # 生成en_US.UTF-8
    case $OS in
        debian|ubuntu)
            sudo sed -i '/en_US.UTF-8/s/^# //' /etc/locale.gen
            sudo locale-gen en_US.UTF-8 > /dev/null
            ;;
        centos)
            sudo localedef -c -f UTF-8 -i en_US en_US.UTF-8 > /dev/null
            ;;
        alpine)
            sudo sed -i 's/^# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
            sudo locale-gen > /dev/null
            ;;
    esac

    # 更新系统配置
    sudo update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 > /dev/null
    export LANG=en_US.UTF-8
    export LC_ALL=en_US.UTF-8
    echo "✔ 语言环境已配置为 en_US.UTF-8"
}

if [ "$LANG" != "en_US.UTF-8" ] || [ "$LC_ALL" != "en_US.UTF-8" ]; then
    configure_locale
else
    echo "✔ 语言环境检查通过 (en_US.UTF-8)"
fi

# ==============================================
# 编辑器编码配置
# ==============================================
echo "▹ 正在配置编辑器..."
# 配置Vim
if command -v vim &> /dev/null; then
    sudo sh -c 'echo "set encoding=utf-8" >> /etc/vim/vimrc'
    echo "✔ Vim编码已配置"
fi

# 配置Nano
if command -v nano &> /dev/null; then
    sudo mkdir -p /etc/nano
    echo "set encoding=utf-8" | sudo tee /etc/nano/nanorc > /dev/null
    echo "✔ Nano编码已配置"
fi

# ==============================================
# 时区配置
# ==============================================
echo "▹ 正在配置时区..."
CURRENT_TZ=$(timedatectl 2>/dev/null | grep "Time zone" | awk '{print $3}')
if [ "$CURRENT_TZ" != "Asia/Shanghai" ]; then
    case $OS in
        debian|ubuntu|centos)
            sudo timedatectl set-timezone Asia/Shanghai
            ;;
        alpine)
            sudo apk add --no-cache tzdata
            sudo ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
            ;;
    esac
    echo "✔ 时区已设置为 Asia/Shanghai"
else
    echo "✔ 时区检查通过 (Asia/Shanghai)"
fi

# ==============================================
# IPv6网络配置
# ==============================================
echo "▹ 正在检查网络配置..."
IPV4_EXISTS=$(ip -4 addr show | grep inet)
IPV6_EXISTS=$(ip -6 addr show | grep inet6)

if [ -z "$IPV4_EXISTS" ] && [ -n "$IPV6_EXISTS" ]; then
    echo "⚠ 检测到仅IPv6网络"
    
    # 测试GitHub连通性
    if ! curl -s -m 10 -I https://github.com > /dev/null; then
        echo "▹ 正在配置IPv6 DNS..."
        sudo cp /etc/resolv.conf /etc/resolv.conf.bak
        echo -e "nameserver 2001:67c:2b0::4\nnameserver 2001:67c:2b0::6" | sudo tee /etc/resolv.conf > /dev/null
        echo "✔ DNS已更新为IPv6优先"
    else
        echo "✔ GitHub访问正常"
    fi
else
    echo "✔ IPv4/IPv6双栈检测通过"
fi

# ==============================================
# sudo配置检查
# ==============================================
echo "▹ 正在检查sudo配置..."
if ! command -v sudo &> /dev/null; then
    echo "▹ 正在安装sudo..."
    case $OS in
        debian|ubuntu)
            apt-get install -y sudo
            ;;
        centos)
            yum install -y sudo
            ;;
        alpine)
            apk add --no-cache sudo
            ;;
    esac
    echo "✔ sudo已安装"
else
    echo "✔ sudo已存在"
fi

# ==============================================
# 系统更新与工具安装
# ==============================================
echo "▹ 正在更新系统组件..."
case $OS in
    debian|ubuntu)
        sudo apt-get update > /dev/null
        sudo apt-get upgrade -y > /dev/null
        sudo apt-get install -y curl wget > /dev/null
        ;;
    centos)
        sudo yum update -y > /dev/null
        sudo yum install -y curl wget > /dev/null
        ;;
    alpine)
        sudo apk update > /dev/null
        sudo apk add curl wget > /dev/null
        ;;
esac
echo "✔ 系统更新完成"

# ==============================================
# 重启确认交互
# ==============================================
echo -e "\n\n=============================================="
echo "✔ 所有配置已完成!"
echo "=============================================="

countdown() {
    local sec=10
    while [ $sec -gt 0 ]; do
        echo -ne "是否立即重启? [Y/n] (默认Y，${sec}秒后自动重启)...\r"
        read -t 1 -n 1 answer && break
        sec=$((sec-1))
    done
    [ -z "$answer" ] && answer="y"
}

show_prompt() {
    countdown
    case $answer in
        [Nn]* )
            echo -e "\n已取消重启，可手动执行命令: sudo reboot"
            ;;
        * )
            echo -e "\n▶ 正在重启系统..."
            sudo reboot
            ;;
    esac
}

show_prompt