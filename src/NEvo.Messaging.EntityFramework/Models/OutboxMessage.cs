namespace NEvo.Messaging.EntityFramework.Models;

public class OutboxMessage(Guid messageId, string payload, string messageType, string headers, int partition)
{
    public Guid MessageId { get; set; } = messageId;
    public string Payload { get; set; } = payload;
    public string MessageType { get; set; } = messageType;
    public string Headers { get; set; } = headers;
    public int Partition { get; set; } = partition;
    public long Order { get; set; }
    public OutboxMessageStatus Status { get; set; } = OutboxMessageStatus.Created;

    public enum OutboxMessageStatus
    { 
        Created,
        Published
    }
}

