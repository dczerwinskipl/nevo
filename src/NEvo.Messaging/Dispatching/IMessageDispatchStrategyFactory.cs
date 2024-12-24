namespace NEvo.Messaging.Dispatching;

public interface IMessageDispatchStrategyFactory<in TMessageGroup> where TMessageGroup : IMessage
{
    IMessageDispatchStrategy CreateFor(TMessageGroup message);
}


