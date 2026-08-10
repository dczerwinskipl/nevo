using System.Reflection;

namespace NEvo.Messaging.Handling;

public static class InterfaceMethodResolver
{
    // Finds the target method via interface map so explicit interface implementations are handled correctly.
    public static MethodInfo Resolve(Type handlerType, Type handlerInterface, string interfaceMethodName)
    {
        var map = handlerType.GetInterfaceMap(handlerInterface);
        var index = Array.FindIndex(map.InterfaceMethods, m => m.Name == interfaceMethodName);
        if (index < 0)
            throw new InvalidOperationException(
                $"Method '{interfaceMethodName}' not found on interface '{handlerInterface}'.");
        return map.TargetMethods[index];
    }
}
