import QtQuick
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "local.omabird"
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "\uf0e0"
    slotSize: Style.bar.statusSlot
    tooltipText: "OmaBird · Open mail\nRight-click · Write a message"
    onPressed: function(mouseButton) {
      if (!root.bar) return
      if (mouseButton === Qt.RightButton)
        root.bar.run("omabird launch -compose")
      else if (mouseButton === Qt.LeftButton)
        root.bar.run("omabird launch")
    }
  }
}
