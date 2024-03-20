namespace NEvo.Messaging.EntityFramework.Models;

public class InboxProcessedHandler(Guid messageId, string handlerKey, DateTime processedAt)
{
    public Guid MessageId { get; set; } = messageId;
    public string HandlerKey { get; set; } = handlerKey;
    public DateTime ProcessedAt { get; set; } = processedAt;
}
