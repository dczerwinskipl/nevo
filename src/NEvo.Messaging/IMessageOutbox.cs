using NEvo.Messaging.Transporting;

namespace NEvo.Messaging;

public interface IMessageOutbox
{
    IAsyncEnumerable<MessageEnvelopeDto> GetMessagesToPublishAsync(int cnt, int? partition);
    Task<Unit> SaveMessageAsync(MessageEnvelopeDto message);
}