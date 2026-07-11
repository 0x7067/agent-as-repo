# frozen_string_literal: true

module Notify
  # Posts rendered alert strings onto a Slack channel via its incoming webhook.
  class Slack
    def initialize(webhook_url)
      @webhook_url = webhook_url
    end

    # Send a rendered alert string onto a Slack channel. Sole definition site of
    # post_alert_message.
    def post_alert_message(text)
      payload = { channel: "#finance-ops", text: text }
      # Real code would POST payload to @webhook_url here.
      payload
    end
  end
end
