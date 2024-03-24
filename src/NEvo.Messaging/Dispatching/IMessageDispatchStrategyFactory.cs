namespace NEvo.Messaging.Dispatch;

public interface IMessageDispatchStrategyFactory<in TMessageGroup> where TMessageGroup : IMessage
{
    IMessageDispatchStrategy CreateFor(TMessageGroup message);
}


