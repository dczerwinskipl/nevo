namespace NEvo.Messaging.Dispatching.External;

public interface IExternalMessageDispatchStrategy : IMessageDispatchStrategy
{
    bool ShouldApply(IMessage message);
}