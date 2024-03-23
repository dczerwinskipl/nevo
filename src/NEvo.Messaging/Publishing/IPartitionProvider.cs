using NEvo.Messaging.Context;

namespace NEvo.Messaging.Publishing;

public interface IPartitionProvider
{
    string GetPartition(IMessage messagge, IMessageContext context);
}
