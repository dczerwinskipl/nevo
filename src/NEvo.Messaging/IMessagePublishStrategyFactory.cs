namespace NEvo.Messaging;

public interface IMessagePublishStrategyFactory<TMessageGroup> where TMessageGroup : IMessage
{
    IMessagePublishStrategy CreateFor(TMessageGroup message);
}


