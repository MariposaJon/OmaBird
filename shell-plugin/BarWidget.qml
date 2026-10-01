// SPDX-License-Identifier: MIT
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

BarWidget {
  id: root
  moduleName: "local.omabird"
  property var mailStatus: null
  property double clock: Date.now()
  property double newMailUntil: 0
  property bool panelOpen: false
  property int selected: 0
  property bool popoutSwitchClosing: false
  readonly property bool opened: panelOpen
  readonly property bool online: Model.isLive(mailStatus, clock)
  readonly property int unread: online ? mailStatus.total : 0
  readonly property var accounts: online ? mailStatus.accounts : []
  readonly property var actions: [
    {label:"Open inbox", action:"inbox", icon:"\uf01c"},
    {label:"Write a message", action:"compose", icon:"\uf044"},
    {label:"Search mail", action:"search", icon:"\uf002"},
    {label:"Mail commands", action:"commands", icon:"\uf120"}
  ].concat(accounts.map(function(a) {
    return {label:a.label + "  ·  " + a.unread + " unread", action:"inbox", account:a.key, icon:"\uf0e0"};
  }))
  implicitWidth: button.implicitWidth + (badge.visible && !vertical ? badge.implicitWidth + Style.space(3) : 0)
  implicitHeight: button.implicitHeight

  function open() { selected = 0; panelOpen = true; statusFile.reload() }
  function close() { panelOpen = false }
  function toggle() { panelOpen ? close() : open() }
  function closeForPopoutSwitch() {
    popoutSwitchClosing = true; close()
    Qt.callLater(function() { root.popoutSwitchClosing = false })
  }
  function runAction(action) {
    close()
    if (action.action === "compose") Quickshell.execDetached(["omabird", "launch", "-compose"])
    else {
      var args = ["omabird", "action", action.action]
      if (action.account) args.push("--account", action.account)
      Quickshell.execDetached(args)
    }
  }
  function readStatus(text) {
    var next = Model.parseStatus(text)
    if (Model.isLive(next, Date.now()) && Model.isLive(mailStatus, Date.now()) && next.total > mailStatus.total)
      newMailUntil = Date.now() + 60000
    mailStatus = next
    selected = Math.min(selected, actions.length - 1)
  }

  FileView {
    id: statusFile
    path: Quickshell.env("HOME") + "/.local/state/omabird/mail.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.readStatus(text())
    onLoadFailed: root.mailStatus = null
  }
  Timer {
    interval: 5000; repeat: true; running: true; triggeredOnStart: true
    onTriggered: { root.clock = Date.now(); statusFile.reload() }
  }

  BarIconButton {
    id: button
    anchors.left: parent.left
    anchors.verticalCenter: parent.verticalCenter
    bar: root.bar
    text: "\uf0e0"
    slotSize: Style.bar.statusSlot
    dimmed: !root.online
    tooltipText: root.online ? "OmaBird · " + root.unread + " unread\nClick · Mail menu · Right-click · Compose" : "OmaBird · Open mail menu\nLaunch Betterbird to update unread counts"
    onPressed: function(mouseButton) {
      if (mouseButton === Qt.RightButton) root.runAction(root.actions[1])
      else if (mouseButton === Qt.MiddleButton) root.runAction(root.actions[0])
      else if (mouseButton === Qt.LeftButton) root.toggle()
    }
    Rectangle {
      visible: root.online && root.clock < root.newMailUntil
      width: Style.space(4); height: width; radius: width / 2
      anchors.right: parent.right; anchors.top: parent.top; anchors.topMargin: Style.space(3)
      color: Color.accent
    }
  }
  Text {
    id: badge
    visible: root.unread > 0 && !root.vertical
    anchors.left: button.right; anchors.verticalCenter: parent.verticalCenter
    text: Model.badge(root.unread)
    textFormat: Text.PlainText
    color: Color.accent
    font.family: Style.font.family
    font.pixelSize: Style.font.caption
    MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.toggle() }
  }

  KeyboardPanel {
    id: popup
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.panelOpen
    focusTarget: keys
    contentWidth: popup.fittedContentWidth(Style.space(340))
    contentHeight: popup.fittedContentHeight(content.implicitHeight)

    PanelKeyCatcher {
      id: keys
      anchors.fill: parent
      onCloseRequested: root.close()
      onMoveRequested: function(dx, dy) {
        if (dy) root.selected = (root.selected + dy + root.actions.length) % root.actions.length
      }
      onActivateRequested: root.runAction(root.actions[root.selected])
      onTabRequested: function(direction) {
        root.selected = (root.selected + direction + root.actions.length) % root.actions.length
      }
      Flickable {
        anchors.fill: parent
        contentWidth: width; contentHeight: content.implicitHeight
        clip: true; boundsBehavior: Flickable.StopAtBounds
        Column {
          id: content
          width: parent.width
          spacing: Style.space(6)
          Text {
            text: "OmaBird"
            textFormat: Text.PlainText
            color: Color.foreground
            font.family: Style.font.family; font.pixelSize: Style.font.body; font.bold: true
          }
          Text {
            width: parent.width
            text: root.online ? root.unread + " unread · " + root.accounts.length + " accounts" : "Betterbird is closed or counts are unavailable"
            textFormat: Text.PlainText
            color: Color.foreground; opacity: 0.7
            font.family: Style.font.family; font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
          }
          PanelSeparator { width: parent.width }
          Repeater {
            model: root.actions
            Button {
              required property var modelData
              required property int index
              width: content.width
              text: modelData.label
              iconText: modelData.icon
              leftAlign: true
              hasCursor: root.selected === index
              onHovered: function(hovered) { if (hovered) root.selected = index }
              onClicked: root.runAction(modelData)
            }
          }
          Text {
            text: "↑↓ / j k select · Enter open · Esc close"
            textFormat: Text.PlainText
            color: Color.foreground; opacity: 0.6
            font.family: Style.font.family; font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }
}
