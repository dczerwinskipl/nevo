namespace NEvo.Messaging;

public interface IMessagePublishStrategyFactory<TMessageGroup> where TMessageGroup : IMessage
{
    public IMessagePublishStrategy CreateFor(TMessageGroup message);
}

