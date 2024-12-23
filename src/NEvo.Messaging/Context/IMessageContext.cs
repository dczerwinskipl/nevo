namespace NEvo.Messaging.Context;

public interface IMessageContext
{
    IMessageContextHeaders Headers { get; }
    Option<string> CorrelationId => Headers.CorrelationId;
    Option<string> CausationId => Headers.CausationId;
    IServiceProvider ServiceProvider { get; }

    T GetFeature<T>() where T : new();
    void SetFeature<T>(T feature) where T : new();
}
