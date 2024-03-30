namespace NEvo.Messaging.Web;

public interface IRestMessageClientFactory
{
    IRestMessageClient CreateFor(IMessage message);
}
