namespace NEvo.Messaging.Dispatch;

public interface IMessageDispatchStrategyFactory<TMessageGroup> where TMessageGroup : IMessage
{
    IMessageDispatchStrategy CreateFor(TMessageGroup message);
}


