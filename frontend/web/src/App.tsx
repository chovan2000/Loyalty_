import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface LoyaltyPoint {
  id: string;
  brand: string;
  points: number;
  exchangeRate: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
  publicValue1: number;
  publicValue2: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<LoyaltyPoint[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPoint, setCreatingPoint] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPointData, setNewPointData] = useState({ brand: "", points: "", rate: "" });
  const [selectedPoint, setSelectedPoint] = useState<LoyaltyPoint | null>(null);
  const [decryptedPoints, setDecryptedPoints] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, brands: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const pointsList: LoyaltyPoint[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          pointsList.push({
            id: businessId,
            brand: businessData.name,
            points: Number(businessData.publicValue1) || 0,
            exchangeRate: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPoints(pointsList);
      updateStats(pointsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (pointsList: LoyaltyPoint[]) => {
    const brands = new Set(pointsList.map(p => p.brand));
    setStats({
      total: pointsList.length,
      verified: pointsList.filter(p => p.isVerified).length,
      brands: brands.size
    });
  };

  const createPoint = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPoint(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating loyalty point with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const pointsValue = parseInt(newPointData.points) || 0;
      const businessId = `point-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, pointsValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPointData.brand,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        pointsValue,
        parseInt(newPointData.rate) || 0,
        "Loyalty Point Entry"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Point created successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPointData({ brand: "", points: "", rate: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPoint(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredPoints = points.filter(point => 
    point.brand.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Points</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🏪</div>
          <div className="stat-content">
            <div className="stat-value">{stats.brands}</div>
            <div className="stat-label">Brands</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Encrypt Points</h4>
            <p>Loyalty points encrypted with FHE before storage</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Store Securely</h4>
            <p>Encrypted data stored on blockchain</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Decrypt Locally</h4>
            <p>Client-side decryption with proof generation</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Verify On-chain</h4>
            <p>Submit proof for on-chain verification</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Loyalty Points 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet</h2>
            <p>Connect your wallet to access encrypted loyalty points system</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Manage encrypted loyalty points</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Exchange points privately</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE System...</p>
        <p>Status: {fhevmInitializing ? "Initializing" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted points...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Loyalty Points 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Points
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Encrypted Loyalty Dashboard</h2>
          {renderStats()}
          
          <div className="fhe-info-panel">
            <h3>FHE Protection Process</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="points-section">
          <div className="section-header">
            <h2>Loyalty Points</h2>
            <div className="header-controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search brands..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="points-list">
            {filteredPoints.length === 0 ? (
              <div className="no-points">
                <p>No loyalty points found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Add First Points
                </button>
              </div>
            ) : filteredPoints.map((point, index) => (
              <div 
                className={`point-item ${selectedPoint?.id === point.id ? "selected" : ""} ${point.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedPoint(point)}
              >
                <div className="point-brand">{point.brand}</div>
                <div className="point-meta">
                  <span>Points: {point.points}</span>
                  <span>Rate: {point.exchangeRate}</span>
                </div>
                <div className="point-status">
                  {point.isVerified ? "✅ Verified" : "🔓 Ready to Verify"}
                </div>
                <div className="point-creator">By: {point.creator.substring(0, 6)}...{point.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreatePoint 
          onSubmit={createPoint} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingPoint} 
          pointData={newPointData} 
          setPointData={setNewPointData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPoint && (
        <PointDetailModal 
          point={selectedPoint} 
          onClose={() => { 
            setSelectedPoint(null); 
            setDecryptedPoints(null); 
          }} 
          decryptedPoints={decryptedPoints} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedPoint.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreatePoint: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  pointData: any;
  setPointData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, pointData, setPointData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'points') {
      const intValue = value.replace(/[^\d]/g, '');
      setPointData({ ...pointData, [name]: intValue });
    } else {
      setPointData({ ...pointData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-point-modal">
        <div className="modal-header">
          <h2>Add Loyalty Points</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption</strong>
            <p>Points will be encrypted with FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Brand Name *</label>
            <input 
              type="text" 
              name="brand" 
              value={pointData.brand} 
              onChange={handleChange} 
              placeholder="Enter brand name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Points (Integer only) *</label>
            <input 
              type="number" 
              name="points" 
              value={pointData.points} 
              onChange={handleChange} 
              placeholder="Enter points..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>
          
          <div className="form-group">
            <label>Exchange Rate *</label>
            <input 
              type="number" 
              name="rate" 
              value={pointData.rate} 
              onChange={handleChange} 
              placeholder="Enter exchange rate..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !pointData.brand || !pointData.points || !pointData.rate} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Points"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PointDetailModal: React.FC<{
  point: LoyaltyPoint;
  onClose: () => void;
  decryptedPoints: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ point, onClose, decryptedPoints, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedPoints !== null) return;
    
    const decrypted = await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="point-detail-modal">
        <div className="modal-header">
          <h2>Point Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="point-info">
            <div className="info-item">
              <span>Brand:</span>
              <strong>{point.brand}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{point.creator.substring(0, 6)}...{point.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(point.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Exchange Rate:</span>
              <strong>{point.exchangeRate}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Points</h3>
            
            <div className="data-row">
              <div className="data-label">Points Value:</div>
              <div className="data-value">
                {point.isVerified && point.decryptedValue ? 
                  `${point.decryptedValue} (Verified)` : 
                  decryptedPoints !== null ? 
                  `${decryptedPoints} (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(point.isVerified || decryptedPoints !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "Decrypting..." : point.isVerified ? "✅ Verified" : decryptedPoints !== null ? "🔄 Re-verify" : "🔓 Decrypt"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected</strong>
                <p>Points encrypted with FHE for privacy protection</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;