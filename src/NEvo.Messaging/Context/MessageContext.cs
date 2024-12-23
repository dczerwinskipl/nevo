using NEvo.Core;

namespace NEvo.Messaging.Context;

public class MessageContext(IDictionary<string, string> headers, IServiceProvider serviceProvider) : IMessageContext
{
    private readonly Dictionary<Type, object> _featureCollection = new();

    public IMessageContextHeaders Headers { get; } = new MessageContextHeaders(Check.Null(headers));

    public IServiceProvider ServiceProvider { get; } = Check.Null(serviceProvider);

    public T GetFeature<T>() where T : new()
    {
        if (!_featureCollection.TryGetValue(typeof(T), out var feature)) 
        {
            feature = new T();
            _featureCollection.Add(typeof(T), feature);
        }

        return (T)feature!;
    }

    public void SetFeature<T>(T feature) where T : new()
    {
        _featureCollection[typeof(T)] = feature!;
    }
}
