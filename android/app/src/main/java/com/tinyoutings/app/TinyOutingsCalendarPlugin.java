package com.tinyoutings.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.provider.CalendarContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TinyOutingsCalendar")
public class TinyOutingsCalendarPlugin extends Plugin {
  @PluginMethod
  public void addEvent(PluginCall call) {
    String title = call.getString("title");
    Long startsAt = call.getLong("startsAt");
    Long endsAt = call.getLong("endsAt");
    if (title == null || startsAt == null || endsAt == null) {
      call.reject("Calendar event details are missing.");
      return;
    }

    Intent intent = new Intent(Intent.ACTION_INSERT)
      .setData(CalendarContract.Events.CONTENT_URI)
      .putExtra(CalendarContract.Events.TITLE, title)
      .putExtra(CalendarContract.Events.DESCRIPTION, call.getString("description", ""))
      .putExtra(CalendarContract.Events.EVENT_LOCATION, call.getString("location", ""))
      .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startsAt)
      .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endsAt);
    try {
      startActivityForResult(call, intent, "handleCalendarResult");
    } catch (ActivityNotFoundException exception) {
      call.reject("No calendar app is installed on this device.", exception);
    }
  }

  @ActivityCallback
  private void handleCalendarResult(PluginCall call, ActivityResult result) {
    if (call != null) call.resolve();
  }
}
