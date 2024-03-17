namespace NEvo.Messaging;

public interface IMessageDispatchStrategyFactory<TMessageGroup> where TMessageGroup : IMessage
{
    IMessageDispatchStrategy CreateFor(TMessageGroup message);
}


