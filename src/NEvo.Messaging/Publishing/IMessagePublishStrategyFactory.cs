using NEvo.Messaging.Publish;

namespace NEvo.Messaging.Publishing;

public interface IMessagePublishStrategyFactory<TMessageGroup> where TMessageGroup : IMessage
{
    IMessagePublishStrategy CreateFor(TMessageGroup message);
}


