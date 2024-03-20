namespace NEvo.Messaging.EntityFramework.Models;

public class InboxProcessedMessage(Guid messageId, DateTime processedAt)
{
    public Guid MessageId { get; set; } = messageId;
    public DateTime ProcessedAt { get; set; } = processedAt;
}